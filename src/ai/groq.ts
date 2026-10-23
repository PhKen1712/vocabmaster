import { DEFAULT_GROQ_MODEL } from '../types';
import { recordDiagnostic } from './diagnostics';
import { parseRetryAfter, redactSecrets } from './errors';
import { loadProviderKey } from './provider';
import { buildPrompt, SYSTEM_INSTRUCTION } from './prompt';
import { DEFAULT_ATTEMPTS, DEFAULT_BASE_DELAY_MS, DEFAULT_MAX_DELAY_MS, retryAsync } from './retry';
import { extractJson, looksTruncated, parseSuggestions } from './schema';
import {
  AiError,
  OUTPUT_CODES,
  RETRYABLE_CODES,
  type AiRequest,
  type AiResult,
  type GenerateOptions,
  type KeyCheck,
} from './types';
import { assertRequest } from './validate';

/**
 * Groq, called directly from the phone with the learner's own key.
 *
 * Groq speaks the OpenAI chat-completions dialect, so this file is the Groq
 * counterpart of `gemini.ts`: same retry budget, same JSON validation, same
 * diagnostics. What differs is the wire format and what the provider does when
 * it is unhappy:
 *
 * - JSON mode (`response_format: {type: "json_object"}`) guarantees valid JSON
 *   but not our exact shape, so `parseSuggestions` still validates every field;
 * - gpt-oss models are reasoning models: reasoning is hidden and kept at low
 *   effort, otherwise it would eat the free tier's token budget;
 * - Groq reports model retirements with a 404 and rate limits with a 429 that
 *   carries `retry-after`. A retired model is replaced once; a busy one is
 *   retried with backoff instead of switching, because Groq's limits are
 *   per-model per-minute and recover in seconds.
 *
 * The free tier is roughly 1.000 requests, 8.000 tokens/phút and 200.000
 * tokens/ngày for gpt-oss (xem console.groq.com/docs/rate-limits). That is a
 * budget per minute, so a big batch can be limited once, not because of a bug.
 */

const API_BASE = 'https://api.groq.com/openai/v1';

export const REQUEST_TIMEOUT_MS = 25_000;
const LIST_TIMEOUT_MS = 15_000;

/**
 * 8.000 TPM includes the input tokens, so the output cap leaves room for the
 * prompt. A bigger batch is reported as truncated rather than silently cut.
 */
const MAX_COMPLETION_TOKENS = 6_144;
const MIN_COMPLETION_TOKENS = 1_024;

export function tokenBudgetGroq(count: number): number {
  const requested = 1_200 + Math.max(1, Math.round(count)) * 400;
  return Math.min(MAX_COMPLETION_TOKENS, Math.max(MIN_COMPLETION_TOKENS, requested));
}

export function defaultGroqModel(): string {
  const fromEnv = process.env.EXPO_PUBLIC_GROQ_MODEL;
  return fromEnv && fromEnv.trim() ? fromEnv.trim() : DEFAULT_GROQ_MODEL;
}

export function normalizeGroqModel(name: string): string {
  return name.trim();
}

/** Production models worth trying first, in order. */
export const GROQ_PREFERRED_MODELS = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'qwen/qwen3.8-27b',
] as const;

/** Speech, embeddings and guard models cannot answer a chat completion. */
const UNUSABLE_MODEL = /whisper|tts|orpheus|guard|embed|vision|safeguard|moderation/i;

/**
 * Rank the models Groq lists for this key, best-first. Known good text models
 * come first; everything else follows alphabetically so a renamed model is
 * still usable instead of leaving the learner stuck.
 */
export function rankGroqModels(ids: string[], current = ''): string[] {
  const skip = normalizeGroqModel(current);
  return ids
    .map((id) => normalizeGroqModel(id))
    .filter((id) => id.length > 0 && id !== skip && !UNUSABLE_MODEL.test(id))
    .filter((id, index, all) => all.indexOf(id) === index)
    .sort((a, b) => {
      const rankA = GROQ_PREFERRED_MODELS.indexOf(a as (typeof GROQ_PREFERRED_MODELS)[number]);
      const rankB = GROQ_PREFERRED_MODELS.indexOf(b as (typeof GROQ_PREFERRED_MODELS)[number]);
      const scoreA = rankA < 0 ? GROQ_PREFERRED_MODELS.length : rankA;
      const scoreB = rankB < 0 ? GROQ_PREFERRED_MODELS.length : rankB;
      if (scoreA !== scoreB) return scoreA - scoreB;
      return a.localeCompare(b);
    });
}

interface GroqErrorBody {
  message?: string;
  type?: string;
  code?: string | number;
}

interface GroqChoice {
  message?: { content?: string | null };
  finish_reason?: string;
}

interface GroqPayload {
  choices?: GroqChoice[];
  error?: GroqErrorBody;
}

interface GroqModelsPayload {
  data?: { id?: string; active?: boolean }[];
  error?: GroqErrorBody;
}

function readHeader(response: Response, name: string): string | null {
  const headers = response.headers as Headers | undefined;
  if (!headers || typeof headers.get !== 'function') return null;
  try {
    return headers.get(name);
  } catch {
    return null;
  }
}

/** Ask Groq which models this key may use. Returns [] when the call fails. */
async function listGroqModels(apiKey: string, signal?: AbortSignal): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LIST_TIMEOUT_MS);
  const forwardAbort = () => controller.abort();
  signal?.addEventListener('abort', forwardAbort);
  try {
    const response = await fetch(`${API_BASE}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as GroqModelsPayload;
    return (payload.data ?? [])
      .filter((item) => item.active !== false)
      .map((item) => normalizeGroqModel(item.id ?? ''))
      .filter((id) => id.length > 0);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

/**
 * Map a Groq HTTP failure onto the app's error codes.
 *
 * Groq returns 429 for both a per-minute burst and the daily token cap. The
 * difference matters: the first can be retried after `retry-after`, the second
 * cannot be fixed by waiting a few seconds. The body says which one it is
 * ("... per day (RPD)", "... tokens per day (TPD)").
 */
export function groqFailure(
  status: number,
  message: string,
  retryAfterMs: number | null = null,
): AiError {
  const text = redactSecrets(message).trim();
  const haystack = text.toLowerCase();

  if (status === 401 || status === 403) {
    return new AiError('invalid_key', text || 'Groq từ chối API key này.', {
      httpStatus: status,
    });
  }
  if (status === 404 || /model.*(not found|decommission|does not exist|no longer)/i.test(text)) {
    return new AiError('model_unavailable', text || 'Model Groq không tồn tại.', {
      httpStatus: status,
    });
  }
  if (status === 429) {
    const daily = /per day|daily|rpd|tpd|tokens per day/.test(haystack);
    if (daily) {
      return new AiError('quota_exceeded', text || 'Key Groq đã chạm hạn mức trong ngày.', {
        httpStatus: status,
      });
    }
    return new AiError('rate_limited', text || 'Groq giới hạn số lần gọi mỗi phút.', {
      httpStatus: status,
      ...(retryAfterMs !== null ? { retryAfterMs } : {}),
    });
  }
  if (status === 408) {
    return new AiError('timeout', text || 'Groq phản hồi quá lâu.', { httpStatus: status });
  }
  if (status === 413) {
    return new AiError(
      'validation',
      'Yêu cầu quá lớn với Groq. Giảm số từ cần tạo (5–8 từ) rồi thử lại.',
      { httpStatus: status },
    );
  }
  if (status === 400 || status === 422) {
    return new AiError('validation', text || 'Groq từ chối nội dung yêu cầu.', {
      httpStatus: status,
    });
  }
  if (status === 498 || status >= 500) {
    return new AiError('server', text || 'Máy chủ Groq tạm thời lỗi.', { httpStatus: status });
  }
  return new AiError(
    'unknown',
    text ? `Groq trả lời HTTP ${status}: ${text}` : `Groq trả lời HTTP ${status}.`,
    { httpStatus: status },
  );
}

/** gpt-oss, qwen3 and the other reasoning families accept these two fields. */
function isReasoningModel(model: string): boolean {
  return /gpt-oss|qwen3|minimax|muse-spark/i.test(model);
}

function reasoningEffortFor(model: string): 'none' | 'low' {
  // Qwen3 reasons only when asked to; gpt-oss always reasons, so keep it cheap.
  return /qwen3/i.test(model) ? 'none' : 'low';
}

interface PostResult {
  response: Response;
  payload: GroqPayload;
  text: string;
  finishReason: string;
  durationMs: number;
}

interface ChatInput {
  model: string;
  apiKey: string;
  system: string;
  user: string;
  maxCompletionTokens: number;
  signal?: AbortSignal;
  attempt: number;
  timeoutMs: number;
}

/**
 * One chat-completions call.
 *
 * Raced against its own deadline and the caller's abort signal, for the same
 * reason as the Gemini path: a platform `fetch` that ignores its signal must
 * not leave the screen on "đang tạo…" forever.
 */
async function postChat(input: ChatInput): Promise<PostResult> {
  const controller = new AbortController();
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let detachAbort: (() => void) | undefined;

  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new AiError(
          'timeout',
          `Groq không trả lời trong ${Math.round(input.timeoutMs / 1000)} giây nên yêu cầu đã bị huỷ.`,
          { stage: 'request' },
        ),
      );
    }, input.timeoutMs);
  });
  deadline.catch(() => undefined);

  const cancelled = new Promise<never>((_, reject) => {
    const signal = input.signal;
    if (!signal) return;
    const onAbort = () => {
      controller.abort();
      reject(new AiError('cancelled', 'Đã huỷ yêu cầu.', { stage: 'request' }));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    detachAbort = () => signal.removeEventListener('abort', onAbort);
  });
  cancelled.catch(() => undefined);

  const reasoning = isReasoningModel(input.model);

  const perform = async (): Promise<PostResult> => {
    const response = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        // GPT-OSS on Groq works best without a separate system turn, so the
        // instruction is the first block of the single user message.
        messages: [
          {
            role: 'user',
            content: `${input.system}\n\n${input.user}`,
          },
        ],
        temperature: 0.6,
        top_p: 0.9,
        max_completion_tokens: input.maxCompletionTokens,
        response_format: { type: 'json_object' },
        ...(reasoning
          ? { reasoning_format: 'hidden', reasoning_effort: reasoningEffortFor(input.model) }
          : {}),
      }),
      signal: controller.signal,
    });

    let payload: GroqPayload = {};
    try {
      payload = (await response.json()) as GroqPayload;
    } catch {
      payload = {};
    }
    const choice = payload.choices?.[0];
    return {
      response,
      payload,
      text: (choice?.message?.content ?? '').trim(),
      finishReason: (choice?.finish_reason ?? '').toLowerCase(),
      durationMs: Date.now() - started,
    };
  };

  try {
    return await Promise.race([perform(), deadline, cancelled]);
  } catch (error) {
    const durationMs = Date.now() - started;
    if (error instanceof AiError) {
      if (error.code !== 'cancelled') {
        recordDiagnostic({
          phase: 'request',
          outcome: 'error',
          provider: 'groq',
          model: input.model,
          attempt: input.attempt,
          durationMs,
          code: error.code,
          detail: error.message,
        });
      }
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    const code = input.signal?.aborted ? 'cancelled' : 'network';
    if (code === 'cancelled') {
      throw new AiError('cancelled', 'Đã huỷ yêu cầu.', { stage: 'request' });
    }
    recordDiagnostic({
      phase: 'request',
      outcome: 'error',
      provider: 'groq',
      model: input.model,
      attempt: input.attempt,
      durationMs,
      code,
      detail: redactSecrets(message),
    });
    throw new AiError('network', 'Không kết nối được tới Groq.', {
      stage: 'request',
      detail: redactSecrets(message),
    });
  } finally {
    if (timer) clearTimeout(timer);
    detachAbort?.();
  }
}

/**
 * One JSON answer, no retry, for small auxiliary questions such as CEFR level
 * estimation. Callers treat a failure as "unknown", never as a dead end.
 */
export async function requestGroqJson(input: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  maxCompletionTokens?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<string> {
  const call = await postChat({
    model: input.model,
    apiKey: input.apiKey,
    system: input.system,
    user: input.user,
    maxCompletionTokens: input.maxCompletionTokens ?? 1_024,
    ...(input.signal ? { signal: input.signal } : {}),
    attempt: 1,
    timeoutMs: input.timeoutMs ?? REQUEST_TIMEOUT_MS,
  });
  if (!call.response.ok) {
    const retryAfterMs = parseRetryAfter(readHeader(call.response, 'retry-after'));
    throw groqFailure(
      call.response.status,
      call.payload.error?.message ?? '',
      retryAfterMs,
    );
  }
  if (!call.text) {
    throw new AiError('invalid_response', 'Groq không trả về nội dung.', { stage: 'response' });
  }
  return call.text;
}

interface InFlight {
  signature: string;
  promise: Promise<AiResult>;
}

let inFlight: InFlight | null = null;

function requestSignature(request: AiRequest, model: string): string {
  return JSON.stringify([
    'groq',
    model,
    request.track,
    request.level,
    request.count,
    request.topic ?? '',
    request.focus ?? '',
    request.lookupTerm ?? '',
    request.avoidTerms.length,
    request.explainTerms?.join('|') ?? '',
  ]);
}

async function runGenerate(
  request: AiRequest,
  apiKey: string,
  options: GenerateOptions,
): Promise<AiResult> {
  const startedAt = Date.now();
  let model = normalizeGroqModel(options.model ?? defaultGroqModel()) || DEFAULT_GROQ_MODEL;
  let fallbackFrom: string | null = null;
  let fallbackReason: AiResult['fallbackReason'] = null;
  let switched = false;
  let attemptsMade = 0;
  const maxAttempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);

  async function callModel(activeModel: string): Promise<AiResult> {
    const call = await postChat({
      model: activeModel,
      apiKey,
      system: SYSTEM_INSTRUCTION,
      user: buildPrompt(request),
      maxCompletionTokens: tokenBudgetGroq(request.count),
      ...(options.signal ? { signal: options.signal } : {}),
      attempt: attemptsMade || 1,
      timeoutMs: options.timeoutMs ?? REQUEST_TIMEOUT_MS,
    });
    const retryAfterMs = parseRetryAfter(readHeader(call.response, 'retry-after'));

    if (!call.response.ok) {
      const failure = groqFailure(
        call.response.status,
        call.payload.error?.message ?? '',
        retryAfterMs,
      );
      recordDiagnostic({
        phase: 'request',
        outcome: 'error',
        provider: 'groq',
        model: activeModel,
        attempt: attemptsMade || 1,
        durationMs: call.durationMs,
        code: failure.code,
        httpStatus: call.response.status,
        detail: failure.message,
      });

      // Groq retires models. Ask which ones this key still has and continue on
      // the best replacement, once, without spending an extra attempt.
      if (failure.code === 'model_unavailable' && !switched) {
        const replacement = rankGroqModels(
          await listGroqModels(apiKey, options.signal),
          activeModel,
        )[0];
        if (replacement) {
          fallbackFrom = activeModel;
          fallbackReason = 'retired';
          switched = true;
          model = replacement;
          recordDiagnostic({
            phase: 'config',
            outcome: 'ok',
            provider: 'groq',
            model: replacement,
            attempt: attemptsMade || 1,
            durationMs: 0,
            code: 'model_unavailable',
            detail: `thay model đã ngừng ${activeModel}`,
          });
          return callModel(replacement);
        }
        throw new AiError(
          'model_unavailable',
          `Model "${activeModel}" không còn khả dụng và không tìm được model thay thế.${
            failure.message ? ` Groq trả lời: ${failure.message}` : ''
          } Mở Cài đặt → AI → Groq rồi bấm "Kiểm tra key + model".`,
          { httpStatus: 404, stage: 'request' },
        );
      }
      throw failure;
    }

    if (!call.text) {
      const reason = call.finishReason;
      recordDiagnostic({
        phase: 'response',
        outcome: 'error',
        provider: 'groq',
        model: activeModel,
        attempt: attemptsMade || 1,
        durationMs: call.durationMs,
        code: 'invalid_response',
        httpStatus: call.response.status,
        detail: reason ? `finish_reason=${reason}` : 'empty text',
      });
      throw new AiError(
        'invalid_response',
        reason === 'content_filter'
          ? 'Groq từ chối nội dung yêu cầu. Thử chủ đề khác.'
          : reason
            ? `Groq không trả về nội dung (lý do: ${reason}).`
            : 'Groq không trả về nội dung.',
        { httpStatus: call.response.status, stage: 'response' },
      );
    }

    const parsed = extractJson(call.text);
    if (parsed === null) {
      const truncated = call.finishReason === 'length' || looksTruncated(call.text);
      recordDiagnostic({
        phase: 'parse',
        outcome: 'error',
        provider: 'groq',
        model: activeModel,
        attempt: attemptsMade || 1,
        durationMs: call.durationMs,
        code: 'json_parse',
        httpStatus: call.response.status,
        detail: `finish_reason=${call.finishReason || 'n/a'} length=${call.text.length}`,
      });
      throw new AiError(
        'json_parse',
        truncated
          ? 'Câu trả lời của Groq bị cắt giữa chừng nên không đọc được JSON. Giảm số từ (5–8 từ) rồi thử lại.'
          : 'Không đọc được JSON từ phản hồi Groq.',
        { httpStatus: call.response.status, stage: 'parse' },
      );
    }

    const { suggestions, rejected, warnings } = parseSuggestions(parsed, request);
    if (suggestions.length === 0) {
      recordDiagnostic({
        phase: 'validate',
        outcome: 'error',
        provider: 'groq',
        model: activeModel,
        attempt: attemptsMade || 1,
        durationMs: call.durationMs,
        code: 'invalid_response',
        httpStatus: call.response.status,
        detail: rejected.slice(0, 2).join(' | ') || 'không có mục hợp lệ',
      });
      throw new AiError(
        'invalid_response',
        `Groq trả về ${rejected.length} mục nhưng không mục nào dùng được${
          rejected[0] ? ` (${rejected[0]})` : ''
        }.`,
        { httpStatus: call.response.status, stage: 'validate' },
      );
    }

    if (call.finishReason === 'length') {
      warnings.push(
        'Câu trả lời bị cắt do giới hạn độ dài nên danh sách có thể chưa đủ số từ bạn yêu cầu.',
      );
    }

    recordDiagnostic({
      phase: 'validate',
      outcome: 'ok',
      provider: 'groq',
      model: activeModel,
      attempt: attemptsMade || 1,
      durationMs: call.durationMs,
      httpStatus: call.response.status,
      detail: `${suggestions.length}/${request.count} từ dùng được`,
    });

    return {
      suggestions,
      rejected,
      warnings,
      model: activeModel,
      fallbackFrom,
      fallbackReason,
      empty: false,
      requested: request.count,
      attempts: attemptsMade || 1,
      elapsedMs: Date.now() - startedAt,
    };
  }

  const result = await retryAsync<AiResult>(
    async (attempt) => {
      attemptsMade = attempt;
      options.onAttempt?.({ attempt, attempts: maxAttempts, model });
      return callModel(model);
    },
    {
      attempts: maxAttempts,
      baseDelayMs: DEFAULT_BASE_DELAY_MS,
      maxDelayMs: DEFAULT_MAX_DELAY_MS,
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.random ? { random: options.random } : {}),
      ...(options.sleep ? { sleep: options.sleep } : {}),
      shouldRetry: (error, attempt) => {
        if (!(error instanceof AiError)) return false;
        if (error.code === 'cancelled') return false;
        if (OUTPUT_CODES.has(error.code)) return attempt === 1;
        // Waiting another full deadline would just double the silence.
        if (error.code === 'timeout') return false;
        return RETRYABLE_CODES.has(error.code);
      },
      onRetry: ({ attempt, attempts, delayMs, error }) => {
        const code = error instanceof AiError ? error.code : 'unknown';
        recordDiagnostic({
          phase: 'request',
          outcome: 'retry',
          provider: 'groq',
          model,
          attempt,
          durationMs: 0,
          delayMs,
          code,
          detail: `sau ${attempt}/${attempts} lần thử`,
        });
        options.onAttempt?.({ attempt: attempt + 1, attempts, model, delayMs });
      },
    },
  );

  return { ...result, attempts: attemptsMade, elapsedMs: Date.now() - startedAt };
}

export async function generateVocabularyGroq(
  request: AiRequest,
  options: GenerateOptions = {},
): Promise<AiResult> {
  assertRequest(request);

  const apiKey = await loadProviderKey('groq');
  if (!apiKey) {
    throw new AiError(
      'missing_key',
      'Chưa có Groq API key. Mở Cài đặt → AI → Groq để thêm key.',
      { stage: 'config' },
    );
  }

  const signature = requestSignature(
    request,
    normalizeGroqModel(options.model ?? defaultGroqModel()),
  );
  if (inFlight) {
    if (inFlight.signature === signature) return inFlight.promise;
    throw new AiError(
      'busy',
      'Đang tạo một bộ từ khác. Chờ lần đang chạy xong rồi bấm lại.',
      { stage: 'config' },
    );
  }

  const promise = runGenerate(request, apiKey, options);
  inFlight = { signature, promise };
  try {
    return await promise;
  } finally {
    if (inFlight?.promise === promise) inFlight = null;
  }
}

/**
 * Kiểm tra key Groq và model mà không tốn token sinh nội dung: gọi endpoint
 * liệt kê model để biết key có hợp lệ và model đang cấu hình có thật không.
 */
export async function checkGroqKey(model = defaultGroqModel()): Promise<KeyCheck> {
  const apiKey = await loadProviderKey('groq');
  if (!apiKey) {
    return { ok: false, detail: 'Chưa có API key Groq. Dán key rồi bấm "Lưu key".' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LIST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
  } catch {
    return {
      ok: false,
      detail: 'Không kết nối được tới Groq. Kiểm tra mạng (thử 4G) rồi bấm lại.',
    };
  } finally {
    clearTimeout(timeout);
  }

  let payload: GroqModelsPayload = {};
  try {
    payload = (await response.json()) as GroqModelsPayload;
  } catch {
    payload = {};
  }

  const message = redactSecrets(payload.error?.message?.trim() ?? '');
  if (!response.ok) {
    const failure = groqFailure(
      response.status,
      message,
      parseRetryAfter(readHeader(response, 'retry-after')),
    );
    recordDiagnostic({
      phase: 'config',
      outcome: 'error',
      provider: 'groq',
      model: normalizeGroqModel(model),
      attempt: 1,
      durationMs: 0,
      code: failure.code,
      httpStatus: response.status,
      detail: failure.message,
    });
    const detail = message ? `HTTP ${response.status} · ${message}` : `HTTP ${response.status}`;
    if (failure.code === 'invalid_key') {
      return { ok: false, detail: `Key bị Groq từ chối · ${detail}` };
    }
    if (failure.code === 'quota_exceeded' || failure.code === 'rate_limited') {
      return { ok: false, detail: `Tạm hết hạn mức · ${detail}` };
    }
    return { ok: false, detail };
  }

  const names = (payload.data ?? [])
    .filter((item) => item.active !== false)
    .map((item) => normalizeGroqModel(item.id ?? ''))
    .filter((id) => id.length > 0);
  const wanted = normalizeGroqModel(model);

  if (wanted && !names.includes(wanted)) {
    const ranked = rankGroqModels(names, wanted);
    const suggestedModel = ranked[0];
    recordDiagnostic({
      phase: 'config',
      outcome: 'error',
      provider: 'groq',
      model: wanted,
      attempt: 1,
      durationMs: 0,
      code: 'model_unavailable',
      httpStatus: response.status,
      detail: `model không có trong danh sách; gợi ý ${suggestedModel ?? 'không có'}`,
    });
    return {
      ok: false,
      detail: `Key hợp lệ nhưng model "${wanted}" không có trong tài khoản Groq. Thử: ${
        ranked.slice(0, 3).join(', ') || DEFAULT_GROQ_MODEL
      }.`,
      ...(suggestedModel ? { suggestedModel } : {}),
    };
  }

  recordDiagnostic({
    phase: 'config',
    outcome: 'ok',
    provider: 'groq',
    model: wanted,
    attempt: 1,
    durationMs: 0,
    httpStatus: response.status,
  });
  return { ok: true, detail: `Key hợp lệ · model "${wanted}" khả dụng.` };
}

/** Test-only: clear single-flight state between cases. */
export function resetGroqGenerationState(): void {
  inFlight = null;
}

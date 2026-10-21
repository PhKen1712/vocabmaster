import * as SecureStore from 'expo-secure-store';

import { DEFAULT_AI_MODEL } from '../types';
import { recordDiagnostic } from './diagnostics';
import { errorFromHttp, parseRetryAfter, redactSecrets } from './errors';
import { buildPrompt, SYSTEM_INSTRUCTION } from './prompt';
import { extractJson, looksTruncated, parseSuggestions, RESPONSE_SCHEMA } from './schema';
import {
  DEFAULT_ATTEMPTS,
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_DELAY_MS,
  retryAsync,
} from './retry';
import {
  AiError,
  OUTPUT_CODES,
  RETRYABLE_CODES,
  type AiRequest,
  type AiResult,
} from './types';

/**
 * Gemini is called directly from the phone. Trade-offs, documented on purpose:
 *
 * - The key is entered by the user in Settings and stored in the iOS Keychain
 *   (expo-secure-store), never in the JS bundle, never in Git, never in logs.
 * - A key stored on a device can still be extracted from a jailbroken phone or
 *   a stolen unlocked phone. For a personal, non-App-Store app this is an
 *   acceptable trade-off. A proxy backend would protect the key better but adds
 *   hosting cost and a server to maintain, which this project avoids.
 * - All study features work without a key; only AI word generation needs it.
 */

const API_KEY_NAME = 'gemini_api_key';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const REQUEST_TIMEOUT_MS = 40_000;
const LIST_TIMEOUT_MS = 15_000;

const DEFAULT_MODEL = DEFAULT_AI_MODEL;

/** Chinese-style output budgets: one rich word can cost ~250-350 tokens. */
const MAX_OUTPUT_TOKENS = 8192;
const MIN_OUTPUT_TOKENS = 2048;

export function tokenBudget(count: number): number {
  const requested = 1600 + Math.max(1, Math.round(count)) * 400;
  return Math.min(MAX_OUTPUT_TOKENS, Math.max(MIN_OUTPUT_TOKENS, requested));
}

export function defaultModel(): string {
  const fromEnv = process.env.EXPO_PUBLIC_GEMINI_MODEL;
  return fromEnv && fromEnv.trim() ? fromEnv.trim() : DEFAULT_MODEL;
}

export async function saveApiKey(value: string): Promise<void> {
  const key = value.trim();
  if (key.length < 20) {
    throw new Error('API key quá ngắn. Hãy dán đúng key lấy từ Google AI Studio.');
  }
  await SecureStore.setItemAsync(API_KEY_NAME, key, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function loadApiKey(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(API_KEY_NAME);
  } catch {
    return null;
  }
}

export async function clearApiKey(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(API_KEY_NAME);
  } catch {
    // Keychain may be unavailable in a simulator without a passcode; nothing to do.
  }
}

export async function hasApiKey(): Promise<boolean> {
  const key = await loadApiKey();
  return Boolean(key && key.trim().length > 0);
}

interface GeminiCandidate {
  content?: { parts?: { text?: string }[] };
  finishReason?: string;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string };
  error?: {
    message?: string;
    status?: string;
    code?: number;
    details?: unknown;
  };
}

interface ModelsResponse {
  models?: { name?: string; supportedGenerationMethods?: string[] }[];
  error?: { message?: string; status?: string };
}

/** Model names cannot be trusted forever: Google retires them for new keys. */
const UNUSABLE_MODEL_NAME =
  /embedding|aqa|imagen|veo|tts|audio|image|live|native|thinking|learnlm|lite/i;

function versionOf(name: string): number {
  const match = name.match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : 0;
}

/**
 * Order candidate models best-first for a text/JSON task: newest flash first,
 * avoiding lite/preview variants, embeddings and media models.
 */
export function rankModels(names: string[], current = ''): string[] {
  const skip = normalizeModel(current);
  return names
    .map((name) => normalizeModel(name))
    .filter((name) => name.length > 0 && name !== skip)
    .filter((name) => /^gemini/i.test(name) && !UNUSABLE_MODEL_NAME.test(name))
    .sort((a, b) => {
      const flash = Number(!/flash/i.test(a)) - Number(!/flash/i.test(b));
      if (flash !== 0) return flash;
      const experimental = Number(/preview|exp/i.test(a)) - Number(/preview|exp/i.test(b));
      if (experimental !== 0) return experimental;
      return versionOf(b) - versionOf(a);
    });
}

export function normalizeModel(name: string): string {
  return name.trim().replace(/^models\//, '');
}

/** Ask Google which models this key may use. Returns [] when the call fails. */
async function listModelNames(apiKey: string, signal?: AbortSignal): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LIST_TIMEOUT_MS);
  const forwardAbort = () => controller.abort();
  signal?.addEventListener('abort', forwardAbort);
  try {
    const response = await fetch(API_BASE, {
      headers: { 'x-goog-api-key': apiKey },
      signal: controller.signal,
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as ModelsResponse;
    return (payload.models ?? [])
      .filter(
        (item) =>
          !item.supportedGenerationMethods ||
          item.supportedGenerationMethods.includes('generateContent'),
      )
      .map((item) => normalizeModel(item.name ?? ''))
      .filter((name) => name.length > 0);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', forwardAbort);
  }
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

interface ErrorMeta {
  message: string;
  statusLabel: string;
  quotaHint: string;
}

/** Pull the useful fields out of an error body without trusting its shape. */
function errorMeta(payload: GeminiResponse): ErrorMeta {
  const error = payload.error;
  const details = error?.details;
  let quotaHint = '';
  if (Array.isArray(details)) {
    quotaHint = details
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return '';
        const violations = (entry as { violations?: unknown }).violations;
        if (!Array.isArray(violations)) return '';
        return violations
          .map((violation) => {
            if (!violation || typeof violation !== 'object') return '';
            const record = violation as Record<string, unknown>;
            return `${String(record.quotaId ?? '')} ${String(record.quotaMetric ?? '')}`;
          })
          .join(' ');
      })
      .join(' ');
  }
  return {
    message: error?.message ?? '',
    statusLabel: error?.status ?? '',
    quotaHint,
  };
}

export interface KeyCheck {
  ok: boolean;
  detail: string;
  /**
   * Model khả dụng gợi ý khi model đang cấu hình đã bị Google ngừng, để UI đổi
   * bằng một lần bấm thay vì bắt người dùng gõ tên model.
   */
  suggestedModel?: string;
}

/**
 * Kiểm tra key và model mà không tốn token sinh nội dung: gọi endpoint liệt kê
 * model để biết key có hợp lệ và model đang cấu hình có thật hay không.
 */
export async function checkApiKey(model = defaultModel()): Promise<KeyCheck> {
  const apiKey = await loadApiKey();
  if (!apiKey) {
    return { ok: false, detail: 'Chưa có API key. Dán key rồi bấm "Lưu key".' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(API_BASE, {
      headers: { 'x-goog-api-key': apiKey },
      signal: controller.signal,
    });
  } catch {
    return {
      ok: false,
      detail: 'Không kết nối được tới Gemini. Kiểm tra mạng (thử 4G) rồi bấm lại.',
    };
  } finally {
    clearTimeout(timeout);
  }

  let payload: ModelsResponse = {};
  try {
    payload = (await response.json()) as ModelsResponse;
  } catch {
    payload = {};
  }

  const message = redactSecrets(payload.error?.message?.trim() ?? '');
  if (!response.ok) {
    const retryAfterMs = parseRetryAfter(readHeader(response, 'retry-after'));
    const failure = errorFromHttp({
      status: response.status,
      message,
      statusLabel: payload.error?.status,
      retryAfterMs,
      stage: 'config',
    });
    recordDiagnostic({
      phase: 'config',
      outcome: 'error',
      model: normalizeModel(model),
      attempt: 1,
      durationMs: 0,
      code: failure.code,
      httpStatus: response.status,
      detail: failure.message,
    });
    const detail = message ? `HTTP ${response.status} · ${message}` : `HTTP ${response.status}`;
    if (failure.code === 'invalid_key') {
      return { ok: false, detail: `Key bị Google từ chối · ${detail}` };
    }
    if (failure.code === 'quota_exceeded' || failure.code === 'rate_limited') {
      return { ok: false, detail: `Tạm hết hạn mức · ${detail}` };
    }
    return { ok: false, detail };
  }

  const names = (payload.models ?? [])
    .map((item) => normalizeModel(item.name ?? ''))
    .filter((name) => name.length > 0);
  const wanted = normalizeModel(model);

  if (wanted && !names.includes(wanted)) {
    const ranked = rankModels(names, wanted);
    const suggestedModel = ranked[0];
    const sample = ranked.slice(0, 3).join(', ');
    recordDiagnostic({
      phase: 'config',
      outcome: 'error',
      model: wanted,
      attempt: 1,
      durationMs: 0,
      code: 'model_unavailable',
      httpStatus: response.status,
      detail: `model không có trong danh sách; gợi ý ${suggestedModel ?? 'không có'}`,
    });
    return {
      ok: false,
      detail: `Key hợp lệ nhưng model "${wanted}" không tồn tại. Thử: ${sample || DEFAULT_MODEL}.`,
      ...(suggestedModel ? { suggestedModel } : {}),
    };
  }

  recordDiagnostic({
    phase: 'config',
    outcome: 'ok',
    model: wanted,
    attempt: 1,
    durationMs: 0,
    httpStatus: response.status,
  });
  return { ok: true, detail: `Key hợp lệ · model "${wanted}" khả dụng.` };
}

interface PostResult {
  response: Response;
  payload: GeminiResponse;
  durationMs: number;
}

/**
 * One HTTP call. Distinguishes "the network died", "we waited too long" and
 * "the caller navigated away", which all abort in similar ways at the fetch
 * layer but need different messages and retry decisions.
 */
async function postGenerate(
  request: AiRequest,
  model: string,
  apiKey: string,
  signal: AbortSignal | undefined,
  maxOutputTokens: number,
  attempt = 1,
): Promise<PostResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const forwardAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timeout);
      throw new AiError('cancelled', 'Đã huỷ yêu cầu.', { stage: 'request' });
    }
    signal.addEventListener('abort', forwardAbort);
  }

  const started = Date.now();
  try {
    const response = await fetch(`${API_BASE}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: [{ role: 'user', parts: [{ text: buildPrompt(request) }] }],
        generationConfig: {
          temperature: 0.6,
          topP: 0.9,
          maxOutputTokens,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
      signal: controller.signal,
    });

    let payload: GeminiResponse = {};
    try {
      payload = (await response.json()) as GeminiResponse;
    } catch {
      payload = {};
    }
    return { response, payload, durationMs: Date.now() - started };
  } catch (error) {
    const durationMs = Date.now() - started;
    const message = error instanceof Error ? error.message : String(error);
    recordDiagnostic({
      phase: 'request',
      outcome: 'error',
      model,
      attempt,
      durationMs,
      code: signal?.aborted ? 'cancelled' : timedOut ? 'timeout' : 'network',
      detail: redactSecrets(message),
    });
    if (signal?.aborted) {
      throw new AiError('cancelled', 'Đã huỷ yêu cầu.', { stage: 'request' });
    }
    if (timedOut) {
      throw new AiError(
        'timeout',
        `Gemini không trả lời trong ${Math.round(REQUEST_TIMEOUT_MS / 1000)} giây nên yêu cầu đã bị huỷ.`,
        { stage: 'request', detail: redactSecrets(message) },
      );
    }
    throw new AiError('network', 'Không kết nối được tới Gemini.', {
      stage: 'request',
      detail: redactSecrets(message),
    });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

export interface GenerateOptions {
  model?: string;
  /** Lets the screen cancel the request when the learner leaves. */
  signal?: AbortSignal;
  attempts?: number;
  /** Injected in tests so retries do not really wait. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  /** Called before each attempt and before each wait. */
  onAttempt?: (info: AttemptInfo) => void;
}

export interface AttemptInfo {
  attempt: number;
  attempts: number;
  model: string;
  /** Present when this attempt waits before running. */
  delayMs?: number;
}

function assertRequest(request: AiRequest): void {
  const problems: string[] = [];
  if (request.track !== 'general' && request.track !== 'ielts') {
    problems.push('track không hợp lệ');
  }
  if (!Number.isInteger(request.level) || request.level < 0 || request.level > 6) {
    problems.push('cấp độ phải là số nguyên 0–6');
  }
  if (!Number.isInteger(request.count) || request.count < 1 || request.count > 20) {
    problems.push('số từ phải từ 1 đến 20');
  }
  if (!Array.isArray(request.avoidTerms) || !Array.isArray(request.weakTerms)) {
    problems.push('danh sách từ kèm theo không hợp lệ');
  }
  if (problems.length > 0) {
    throw new AiError('validation', problems.join('; '), { stage: 'config' });
  }
}

interface InFlight {
  signature: string;
  promise: Promise<AiResult>;
}

let inFlight: InFlight | null = null;

function requestSignature(request: AiRequest, model: string): string {
  return JSON.stringify([
    model,
    request.track,
    request.level,
    request.count,
    request.topic ?? '',
    request.focus ?? '',
    request.lookupTerm ?? '',
    request.avoidTerms.length,
  ]);
}

async function runGenerate(
  request: AiRequest,
  apiKey: string,
  options: GenerateOptions,
): Promise<AiResult> {
  const startedAt = Date.now();
  let model = normalizeModel(options.model ?? defaultModel()) || DEFAULT_MODEL;
  let fallbackFrom: string | null = null;
  let switched = false;
  let attemptsMade = 0;
  const maxAttempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);

  async function callModel(activeModel: string): Promise<AiResult> {
    const call = await postGenerate(
      request,
      activeModel,
      apiKey,
      options.signal,
      tokenBudget(request.count),
      attemptsMade || 1,
    );
    const meta = errorMeta(call.payload);
    const retryAfterMs = parseRetryAfter(readHeader(call.response, 'retry-after'));

    if (!call.response.ok) {
      const failure = errorFromHttp({
        status: call.response.status,
        message: meta.message,
        statusLabel: meta.statusLabel,
        quotaHint: meta.quotaHint,
        retryAfterMs,
      });
      recordDiagnostic({
        phase: 'request',
        outcome: 'error',
        model: activeModel,
        attempt: attemptsMade || 1,
        durationMs: call.durationMs,
        code: failure.code,
        httpStatus: call.response.status,
        detail: failure.message,
      });

      // Google retires models for new API keys ("no longer available to new
      // users"). Instead of stranding the learner on a 404 until the next
      // build, ask Google which models this key may use and continue with the
      // best one — once, inside this same attempt.
      if (failure.code === 'model_unavailable' && !switched) {
        const replacement = rankModels(await listModelNames(apiKey, options.signal), activeModel)[0];
        if (replacement) {
          fallbackFrom = activeModel;
          switched = true;
          model = replacement;
          recordDiagnostic({
            phase: 'config',
            outcome: 'ok',
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
            meta.message ? ` Google trả lời: ${meta.message}` : ''
          } Mở Cài đặt → Gemini AI rồi bấm "Kiểm tra key + model".`,
          { httpStatus: 404, stage: 'request' },
        );
      }
      if (failure.code === 'model_unavailable') {
        throw new AiError(
          'model_unavailable',
          `Cả "${fallbackFrom}" và "${model}" đều không dùng được. Mở Cài đặt → Gemini AI rồi bấm "Kiểm tra key + model".`,
          { httpStatus: 404, stage: 'request' },
        );
      }
      throw failure;
    }

    const blockReason = call.payload.promptFeedback?.blockReason;
    if (blockReason) {
      recordDiagnostic({
        phase: 'response',
        outcome: 'error',
        model: activeModel,
        attempt: attemptsMade || 1,
        durationMs: call.durationMs,
        code: 'invalid_response',
        httpStatus: call.response.status,
        detail: `blockReason=${blockReason}`,
      });
      throw new AiError(
        'invalid_response',
        `Gemini từ chối yêu cầu (${blockReason}). Thử chủ đề khác.`,
        { httpStatus: call.response.status, stage: 'response' },
      );
    }

    const candidate = call.payload.candidates?.[0];
    const finishReason = (candidate?.finishReason ?? '').toUpperCase();
    const text = (candidate?.content?.parts ?? [])
      .map((part) => part.text ?? '')
      .join('')
      .trim();

    if (!text) {
      recordDiagnostic({
        phase: 'response',
        outcome: 'error',
        model: activeModel,
        attempt: attemptsMade || 1,
        durationMs: call.durationMs,
        code: 'invalid_response',
        httpStatus: call.response.status,
        detail: finishReason ? `finishReason=${finishReason}` : 'empty text',
      });
      throw new AiError(
        'invalid_response',
        finishReason
          ? `Gemini không trả về nội dung (lý do: ${finishReason}).`
          : 'Gemini không trả về nội dung.',
        { httpStatus: call.response.status, stage: 'response' },
      );
    }

    const parsed = extractJson(text);
    if (parsed === null) {
      const truncated = finishReason === 'MAX_TOKENS' || looksTruncated(text);
      recordDiagnostic({
        phase: 'parse',
        outcome: 'error',
        model: activeModel,
        attempt: attemptsMade || 1,
        durationMs: call.durationMs,
        code: 'json_parse',
        httpStatus: call.response.status,
        detail: `finishReason=${finishReason || 'n/a'} length=${text.length}`,
      });
      throw new AiError(
        'json_parse',
        truncated
          ? 'Câu trả lời của Gemini bị cắt giữa chừng nên không đọc được JSON. Giảm số từ (5–8 từ) rồi thử lại.'
          : 'Không đọc được JSON từ phản hồi Gemini.',
        { httpStatus: call.response.status, stage: 'parse' },
      );
    }

    const { suggestions, rejected, warnings } = parseSuggestions(parsed, request);
    if (suggestions.length === 0) {
      recordDiagnostic({
        phase: 'validate',
        outcome: 'error',
        model: activeModel,
        attempt: attemptsMade || 1,
        durationMs: call.durationMs,
        code: 'invalid_response',
        httpStatus: call.response.status,
        detail: rejected.slice(0, 2).join(' | ') || 'không có mục hợp lệ',
      });
      throw new AiError(
        'invalid_response',
        `Gemini trả về ${rejected.length} mục nhưng không mục nào dùng được${
          rejected[0] ? ` (${rejected[0]})` : ''
        }.`,
        { httpStatus: call.response.status, stage: 'validate' },
      );
    }

    if (finishReason === 'MAX_TOKENS') {
      warnings.push(
        'Câu trả lời bị cắt do giới hạn độ dài nên danh sách có thể chưa đủ số từ bạn yêu cầu.',
      );
    }

    recordDiagnostic({
      phase: 'validate',
      outcome: 'ok',
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
      signal: options.signal,
      ...(options.random ? { random: options.random } : {}),
      ...(options.sleep ? { sleep: options.sleep } : {}),
      shouldRetry: (error, attempt) => {
        if (!(error instanceof AiError)) return false;
        if (error.code === 'cancelled') return false;
        // Unusable model output gets exactly one second chance, then we stop
        // instead of paying for more calls that the learner cannot use.
        if (OUTPUT_CODES.has(error.code)) return attempt === 1;
        return RETRYABLE_CODES.has(error.code);
      },
      onRetry: ({ attempt, attempts, delayMs, error }) => {
        const code = error instanceof AiError ? error.code : 'unknown';
        recordDiagnostic({
          phase: 'request',
          outcome: 'retry',
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

export async function generateVocabulary(
  request: AiRequest,
  modelOrOptions: string | GenerateOptions = {},
): Promise<AiResult> {
  const options: GenerateOptions =
    typeof modelOrOptions === 'string' ? { model: modelOrOptions } : modelOrOptions;

  assertRequest(request);

  const apiKey = await loadApiKey();
  if (!apiKey) {
    throw new AiError('missing_key', 'Chưa có Gemini API key. Mở Cài đặt → Gemini AI để thêm key.', {
      stage: 'config',
    });
  }

  const signature = requestSignature(request, normalizeModel(options.model ?? defaultModel()));
  if (inFlight) {
    // Same request twice (double tap, retry pressed twice): share one call
    // instead of paying twice and creating duplicate drafts.
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

/** Test-only: clear single-flight state between cases. */
export function resetGenerationState(): void {
  inFlight = null;
}

import * as SecureStore from 'expo-secure-store';

import { DEFAULT_AI_MODEL } from '../types';
import { buildPrompt, SYSTEM_INSTRUCTION } from './prompt';
import { extractJson, parseSuggestions, RESPONSE_SCHEMA } from './schema';
import { AiError, type AiRequest, type AiResult } from './types';

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

const DEFAULT_MODEL = DEFAULT_AI_MODEL;

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
  error?: { message?: string; status?: string; code?: number };
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
  const skip = current.trim().replace(/^models\//, '');
  return names
    .map((name) => name.replace(/^models\//, '').trim())
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

/** Ask Google which models this key may use. Returns [] when the call fails. */
async function listModelNames(apiKey: string): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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
      .map((item) => (item.name ?? '').replace(/^models\//, ''))
      .filter((name) => name.length > 0);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function isModelGone(status: number, payload: GeminiResponse): boolean {
  const message = payload.error?.message ?? '';
  return (
    status === 404 ||
    payload.error?.status === 'NOT_FOUND' ||
    /no longer available|not found|is not supported/i.test(message)
  );
}

function mapHttpError(status: number, message: string): AiError {
  if (status === 401 || status === 403 || /API key not valid|API_KEY_INVALID/i.test(message)) {
    return new AiError('invalid_key', message || 'API key không hợp lệ.');
  }
  if (status === 429) {
    return new AiError('rate_limited', message || 'Đã chạm giới hạn tần suất.', true);
  }
  if (status >= 500) {
    return new AiError('server', message || 'Gemini tạm thời không phản hồi.', true);
  }
  // Giữ mã HTTP trong thông báo: nếu không, lỗi 404 (sai tên model) bị hiển thị
  // thành một câu chung chung và người dùng không biết phải sửa gì.
  return new AiError(
    'unknown',
    message ? `Gemini trả về lỗi ${status}: ${message}` : `Gemini trả về lỗi ${status}.`,
  );
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

  const message = payload.error?.message?.trim();
  if (!response.ok) {
    const detail = message ? `HTTP ${response.status} · ${message}` : `HTTP ${response.status}`;
    if (response.status === 401 || response.status === 403) {
      return { ok: false, detail: `Key bị Google từ chối · ${detail}` };
    }
    if (response.status === 429) {
      return { ok: false, detail: `Tạm hết hạn mức · ${detail}` };
    }
    return { ok: false, detail };
  }

  const names = (payload.models ?? [])
    .map((item) => (item.name ?? '').replace(/^models\//, ''))
    .filter((name) => name.length > 0);
  const wanted = model.trim().replace(/^models\//, '');

  if (wanted && !names.includes(wanted)) {
    const ranked = rankModels(names, wanted);
    const suggestedModel = ranked[0];
    const sample = ranked.slice(0, 3).join(', ');
    return {
      ok: false,
      detail: `Key hợp lệ nhưng model "${wanted}" không tồn tại. Thử: ${sample || DEFAULT_MODEL}.`,
      ...(suggestedModel ? { suggestedModel } : {}),
    };
  }

  return { ok: true, detail: `Key hợp lệ · model "${wanted}" khả dụng.` };
}

interface GeminiCall {
  response: Response;
  payload: GeminiResponse;
}

async function postGenerate(
  request: AiRequest,
  model: string,
  apiKey: string,
): Promise<GeminiCall> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/${encodeURIComponent(model)}:generateContent`, {
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
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
      signal: controller.signal,
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    throw new AiError(
      'network',
      aborted ? 'Gemini phản hồi quá lâu. Thử lại với ít từ hơn.' : 'Không kết nối được tới Gemini.',
      true,
    );
  } finally {
    clearTimeout(timeout);
  }

  let payload: GeminiResponse = {};
  try {
    payload = (await response.json()) as GeminiResponse;
  } catch {
    payload = {};
  }

  return { response, payload };
}

export async function generateVocabulary(
  request: AiRequest,
  model = defaultModel(),
): Promise<AiResult> {
  const apiKey = await loadApiKey();
  if (!apiKey) throw new AiError('missing_key', 'Chưa có Gemini API key.');

  let usedModel = model.trim().replace(/^models\//, '') || DEFAULT_MODEL;
  let call = await postGenerate(request, usedModel, apiKey);
  let fallbackFrom: string | null = null;

  // Google retires models for new API keys ("no longer available to new
  // users"). Instead of stranding the learner on a 404 until the next build,
  // ask Google which models this key may use and retry once with the best one.
  if (isModelGone(call.response.status, call.payload)) {
    const replacement = rankModels(await listModelNames(apiKey), usedModel)[0];
    const googleMessage = call.payload.error?.message?.trim();
    if (!replacement) {
      throw new AiError(
        'model_unavailable',
        `Model "${usedModel}" không còn khả dụng và không tìm được model thay thế.${
          googleMessage ? ` Google trả lời: ${googleMessage}` : ''
        } Mở Cài đặt → Gemini AI rồi bấm "Kiểm tra key + model".`,
      );
    }
    fallbackFrom = usedModel;
    usedModel = replacement;
    call = await postGenerate(request, usedModel, apiKey);
    if (isModelGone(call.response.status, call.payload)) {
      throw new AiError(
        'model_unavailable',
        `Cả "${fallbackFrom}" và "${usedModel}" đều không dùng được. Mở Cài đặt → Gemini AI rồi bấm "Kiểm tra key + model".`,
      );
    }
  }

  const { response, payload } = call;

  if (!response.ok) {
    if (response.status === 400 && payload.error?.status === 'INVALID_ARGUMENT') {
      throw new AiError('invalid_response', payload.error?.message ?? 'Yêu cầu không hợp lệ.');
    }
    throw mapHttpError(response.status, payload.error?.message ?? '');
  }

  if (payload.promptFeedback?.blockReason) {
    throw new AiError(
      'invalid_response',
      `Gemini từ chối yêu cầu (${payload.promptFeedback.blockReason}). Thử chủ đề khác.`,
    );
  }

  const text = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? '')
    .join('')
    .trim();

  if (!text) {
    throw new AiError('invalid_response', 'Gemini không trả về nội dung.');
  }

  const parsed = extractJson(text);
  if (!parsed) {
    throw new AiError('invalid_response', 'Không đọc được JSON từ phản hồi Gemini.');
  }

  const { suggestions, rejected } = parseSuggestions(parsed, request);
  return {
    suggestions,
    rejected,
    model: usedModel,
    fallbackFrom,
    empty: suggestions.length === 0,
  };
}

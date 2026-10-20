import * as SecureStore from 'expo-secure-store';

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

const DEFAULT_MODEL = 'gemini-2.5-flash';

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
  return new AiError('unknown', message || `Gemini trả về lỗi ${status}.`);
}

export async function generateVocabulary(
  request: AiRequest,
  model = defaultModel(),
): Promise<AiResult> {
  const apiKey = await loadApiKey();
  if (!apiKey) throw new AiError('missing_key', 'Chưa có Gemini API key.');

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
    model,
    empty: suggestions.length === 0,
  };
}

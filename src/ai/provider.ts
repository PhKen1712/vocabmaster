import { loadSecret, removeSecret, saveSecret } from '../lib/secureStorage';
import type { AiProvider } from '../types';

/**
 * Per-provider API keys.
 *
 * Each provider gets its own slot, so switching from Gemini to Groq (and back)
 * never overwrites or deletes the other key. Keys never enter the JS bundle,
 * Git or a log line.
 *
 * Nơi lưu do `lib/secureStorage` quyết định: Keychain trên iOS, localStorage
 * trên web. Trước đây file này gọi thẳng `expo-secure-store`, thứ không tồn tại
 * trên trình duyệt, nên lưu Groq key làm app ném
 * "setValueWithKeyAsync is not a function".
 */

export interface ProviderInfo {
  label: string;
  keyName: string;
  /** Shown above the key field, matching what the provider actually issues. */
  placeholder: string;
  /** Page where the learner creates a key. Opened from Settings. */
  keysUrl: string;
  /** Where to read about quota and models. */
  docsUrl: string;
  keyHint: string;
}

export const PROVIDER_INFO: Record<AiProvider, ProviderInfo> = {
  gemini: {
    label: 'Gemini',
    keyName: 'gemini_api_key',
    placeholder: 'Dán Gemini API key (AIza…)',
    keysUrl: 'https://aistudio.google.com/apikey',
    docsUrl: 'https://ai.google.dev/gemini-api/docs/rate-limits',
    keyHint: 'Key lấy từ Google AI Studio, bắt đầu bằng "AIza".',
  },
  groq: {
    label: 'Groq',
    keyName: 'groq_api_key',
    placeholder: 'Dán Groq API key (gsk_…)',
    keysUrl: 'https://console.groq.com/keys',
    docsUrl: 'https://console.groq.com/docs/rate-limits',
    keyHint: 'Key lấy từ Groq Console, bắt đầu bằng "gsk_".',
  },
};

export function providerLabel(provider: AiProvider): string {
  return PROVIDER_INFO[provider].label;
}

export async function saveProviderKey(provider: AiProvider, value: string): Promise<void> {
  const info = PROVIDER_INFO[provider];
  const key = value.trim();
  if (key.length < 20) {
    throw new Error(
      `API key quá ngắn. Hãy dán đúng key ${info.label} (${
        provider === 'groq' ? 'gsk_…' : 'AIza…'
      }).`,
    );
  }
  if (provider === 'groq' && !key.startsWith('gsk_')) {
    // A Gemini key pasted here would otherwise fail later with a confusing 401.
    throw new Error('Key Groq bắt đầu bằng "gsk_". Key này trông không phải key Groq.');
  }
  const backend = await saveSecret(info.keyName, key);
  if (backend === 'memory') {
    throw new Error(
      'Không có chỗ lưu bền vững trên thiết bị này. Khoá chỉ dùng được trong phiên hiện tại.',
    );
  }
}

export async function loadProviderKey(provider: AiProvider): Promise<string | null> {
  return loadSecret(PROVIDER_INFO[provider].keyName);
}

export async function clearProviderKey(provider: AiProvider): Promise<void> {
  await removeSecret(PROVIDER_INFO[provider].keyName);
}

export async function hasProviderKey(provider: AiProvider): Promise<boolean> {
  const key = await loadProviderKey(provider);
  return Boolean(key && key.trim().length > 0);
}

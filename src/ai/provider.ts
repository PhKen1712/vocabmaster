import * as SecureStore from 'expo-secure-store';

import type { AiProvider } from '../types';

/**
 * Per-provider API keys.
 *
 * Each provider gets its own Keychain slot, so switching from Gemini to Groq
 * (and back) never overwrites or deletes the other key. Keys live only in the
 * device Keychain: never in the JS bundle, never in Git, never in a log line.
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
  await SecureStore.setItemAsync(info.keyName, key, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function loadProviderKey(provider: AiProvider): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(PROVIDER_INFO[provider].keyName);
  } catch {
    return null;
  }
}

export async function clearProviderKey(provider: AiProvider): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(PROVIDER_INFO[provider].keyName);
  } catch {
    // Keychain may be unavailable in a simulator without a passcode; nothing to do.
  }
}

export async function hasProviderKey(provider: AiProvider): Promise<boolean> {
  const key = await loadProviderKey(provider);
  return Boolean(key && key.trim().length > 0);
}

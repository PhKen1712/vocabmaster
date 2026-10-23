import * as Speech from 'expo-speech';

import { duckMusic, releaseMusicDuck } from '../music/duck';
import type { TtsVoice } from '../types';
import { pickVoice, type VoiceLike } from './voices';

export { pickVoice, voiceAvailability, type VoiceLike, type VoiceAvailability } from './voices';

/**
 * Text to speech uses the iPhone's built-in voices through expo-speech.
 * No network, no API key, no cost. Voice quality depends on the voices the user
 * has downloaded in iOS Settings → Accessibility → Spoken Content.
 *
 * The app picks a specific voice per accent and gender when one is installed,
 * and otherwise falls back to another English voice rather than silently
 * pretending the requested voice exists. Settings tells the learner which case
 * applies on this device.
 */

type Voice = Awaited<ReturnType<typeof Speech.getAvailableVoicesAsync>>[number];

let cachedVoices: Voice[] | null = null;

export interface SpeechPreferences {
  accent: 'en-US' | 'en-GB';
  voice: TtsVoice;
}

let preferences: SpeechPreferences = { accent: 'en-US', voice: 'auto' };

/** Called once when settings load and whenever the learner changes them. */
export function configureSpeech(next: SpeechPreferences): void {
  preferences = { accent: next.accent, voice: next.voice };
}

export function getSpeechPreferences(): SpeechPreferences {
  return preferences;
}

export async function getEnglishVoices(force = false): Promise<Voice[]> {
  if (cachedVoices && !force) return cachedVoices;
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    cachedVoices = voices.filter((voice) => voice.language?.toLowerCase().startsWith('en'));
    return cachedVoices;
  } catch {
    return [];
  }
}

export interface SpeakOptions {
  accent?: 'en-US' | 'en-GB';
  voice?: TtsVoice;
  rate?: number;
  onDone?: () => void;
  onError?: (message: string) => void;
}

export async function speak(text: string, options: SpeakOptions = {}): Promise<void> {
  const content = text.trim();
  if (!content) return;
  const accent = options.accent ?? preferences.accent;
  const gender = options.voice ?? preferences.voice;
  const voices = await getEnglishVoices();
  const voice = pickVoice(voices, accent, gender);

  const finish = () => {
    releaseMusicDuck();
    options.onDone?.();
  };
  const fail = (message: string) => {
    releaseMusicDuck();
    options.onError?.(message);
  };

  try {
    duckMusic();
    await Speech.stop();
    Speech.speak(content, {
      language: accent,
      voice: voice?.identifier,
      rate: options.rate ?? 0.92,
      pitch: 1,
      onDone: finish,
      onError: () => fail('Không phát được âm thanh. Kiểm tra chế độ im lặng của iPhone.'),
    });
  } catch {
    fail('Không phát được âm thanh trên thiết bị này.');
  }
}

export async function stopSpeaking(): Promise<void> {
  try {
    await Speech.stop();
  } finally {
    releaseMusicDuck();
  }
}

export async function isSpeaking(): Promise<boolean> {
  try {
    return await Speech.isSpeakingAsync();
  } catch {
    return false;
  }
}

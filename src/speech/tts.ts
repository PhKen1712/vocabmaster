import * as Speech from 'expo-speech';

import { activateSpeechAudio, restoreMediaAudio } from '../audio/session';
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

/** Incremented on every call so a stale finish callback cannot reset audio. */
let speechToken = 0;

export async function speak(text: string, options: SpeakOptions = {}): Promise<void> {
  const content = text.trim();
  if (!content) return;
  const accent = options.accent ?? preferences.accent;
  const gender = options.voice ?? preferences.voice;
  const voices = await getEnglishVoices();
  const voice = pickVoice(voices, accent, gender);
  const token = ++speechToken;

  const finish = () => {
    releaseMusicDuck();
    if (token === speechToken) void restoreMediaAudio();
    options.onDone?.();
  };
  const fail = (message: string) => {
    releaseMusicDuck();
    if (token === speechToken) void restoreMediaAudio();
    options.onError?.(message);
  };

  try {
    // Upgrade the session to playback before the first syllable. Without this
    // the silent switch mutes TTS and the learner has to enable the ringer.
    await activateSpeechAudio();
    duckMusic();
    await Speech.stop();
    Speech.speak(content, {
      language: accent,
      voice: voice?.identifier,
      rate: options.rate ?? 0.92,
      pitch: 1,
      volume: 1,
      // Let the system manage speech in its own session; this keeps a
      // vocabulary word audible even while the app plays quiet background
      // music, and restores cleanly after a phone call or Siri.
      useApplicationAudioSession: false,
      onDone: finish,
      onStopped: () => releaseMusicDuck(),
      onError: () => fail('Không phát được âm thanh trên thiết bị này.'),
    });
  } catch {
    fail('Không phát được âm thanh trên thiết bị này.');
  }
}

export async function stopSpeaking(): Promise<void> {
  speechToken += 1;
  try {
    await Speech.stop();
  } finally {
    releaseMusicDuck();
    void restoreMediaAudio();
  }
}

export async function isSpeaking(): Promise<boolean> {
  try {
    return await Speech.isSpeakingAsync();
  } catch {
    return false;
  }
}

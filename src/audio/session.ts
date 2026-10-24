import { setAudioModeAsync } from 'expo-audio';

/**
 * iOS audio session policy.
 *
 * Music is a background nicety and follows the Ring/Silent switch, so it keeps
 * `playsInSilentMode: false`. Vocabulary pronunciation must be audible even
 * when the phone is on silent — the learner is explicitly asking to hear a
 * word — so speaking temporarily upgrades the same session to playback.
 *
 * The old bug was that the app never changed category at all: expo-speech ran
 * inside the ambient session created for music, so the silent switch muted the
 * word and the volume keys (media volume) did not help.
 */

const MEDIA_MODE = {
  playsInSilentMode: false,
  interruptionMode: 'mixWithOthers' as const,
  allowsRecording: false,
  shouldPlayInBackground: false,
};

const SPEECH_MODE = {
  ...MEDIA_MODE,
  playsInSilentMode: true,
};

export async function restoreMediaAudio(): Promise<void> {
  try {
    await setAudioModeAsync(MEDIA_MODE);
  } catch {
    // The device may be in a call or a simulator without a session; the next
    // speak() call will try again.
  }
}

export async function activateSpeechAudio(): Promise<void> {
  try {
    await setAudioModeAsync(SPEECH_MODE);
  } catch {
    // Keep going: expo-speech's private session can still play the word.
  }
}

import * as Speech from 'expo-speech';

/**
 * Text to speech uses the iPhone's built-in voices through expo-speech.
 * No network, no API key, no cost. Voice quality depends on the voices the user
 * has downloaded in iOS Settings → Accessibility → Spoken Content.
 */

type Voice = Awaited<ReturnType<typeof Speech.getAvailableVoicesAsync>>[number];

let cachedVoices: Voice[] | null = null;

export async function getEnglishVoices(): Promise<Voice[]> {
  if (cachedVoices) return cachedVoices;
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    cachedVoices = voices.filter((voice) => voice.language?.toLowerCase().startsWith('en'));
    return cachedVoices;
  } catch {
    return [];
  }
}

function pickVoice(voices: Voice[], accent: 'en-US' | 'en-GB'): Voice | undefined {
  const exact = voices.filter(
    (voice) => voice.language?.toLowerCase().replace('_', '-') === accent.toLowerCase(),
  );
  if (exact.length === 0) return undefined;
  // Prefer a higher-quality downloaded voice when one exists. The quality field
  // is platform-specific, so compare as text instead of relying on its type.
  const preferred = exact.find((voice) =>
    /enhanced|premium/i.test(String((voice as { quality?: string }).quality ?? '')),
  );
  return preferred ?? exact[0];
}

export interface SpeakOptions {
  accent?: 'en-US' | 'en-GB';
  rate?: number;
  onDone?: () => void;
  onError?: (message: string) => void;
}

export async function speak(text: string, options: SpeakOptions = {}): Promise<void> {
  const content = text.trim();
  if (!content) return;
  const accent = options.accent ?? 'en-US';
  const voices = await getEnglishVoices();
  const voice = pickVoice(voices, accent);

  try {
    await Speech.stop();
    Speech.speak(content, {
      language: accent,
      voice: voice?.identifier,
      rate: options.rate ?? 0.92,
      pitch: 1,
      onDone: options.onDone,
      onError: () => options.onError?.('Không phát được âm thanh. Kiểm tra chế độ im lặng của iPhone.'),
    });
  } catch {
    options.onError?.('Không phát được âm thanh trên thiết bị này.');
  }
}

export async function stopSpeaking(): Promise<void> {
  try {
    await Speech.stop();
  } catch {
    // Ignore: nothing was playing.
  }
}

export async function isSpeaking(): Promise<boolean> {
  try {
    return await Speech.isSpeakingAsync();
  } catch {
    return false;
  }
}

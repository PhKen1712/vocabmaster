import type { TtsVoice } from '../types';

/**
 * iOS does not expose a gender field on a voice. These are the English voice
 * names Apple ships; a name nothing matches is treated as "no preference" so a
 * future voice still works instead of being rejected.
 */
const FEMALE_NAMES = [
  'samantha', 'karen', 'moira', 'tessa', 'fiona', 'serena', 'allison', 'susan',
  'zoe', 'ava', 'emma', 'nicky', 'kate', 'stephanie', 'joanna', 'salli',
  'kendra', 'kimberly', 'ivy', 'amy', 'nicole', 'catherine', 'martha', 'libby',
  'sonia', 'maisie', 'olivia', 'female',
];
const MALE_NAMES = [
  'daniel', 'alex', 'fred', 'tom', 'aaron', 'arthur', 'gordon', 'lee',
  'oliver', 'rishi', 'david', 'mark', 'james', 'matthew', 'justin', 'joey',
  'brian', 'russell', 'male',
];

export interface VoiceLike {
  identifier: string;
  language?: string;
  name?: string;
  quality?: string | number;
}

export type VoiceAvailability = 'exact' | 'accent-only' | 'none';

function voiceName(voice: VoiceLike): string {
  return String(voice.name ?? voice.identifier ?? '').toLowerCase();
}

function matchesGender(voice: VoiceLike, gender: 'female' | 'male'): boolean {
  const name = voiceName(voice);
  const hints = gender === 'female' ? FEMALE_NAMES : MALE_NAMES;
  return hints.some((hint) => name.includes(hint));
}

function isHighQuality(voice: VoiceLike): boolean {
  return /enhanced|premium/i.test(String(voice.quality ?? ''));
}

function sameAccent(voice: VoiceLike, accent: 'en-US' | 'en-GB'): boolean {
  return String(voice.language ?? '').toLowerCase().replace('_', '-') === accent.toLowerCase();
}

/** Best installed voice for an accent + gender, or undefined. */
export function pickVoice(
  voices: readonly VoiceLike[],
  accent: 'en-US' | 'en-GB',
  gender: TtsVoice = 'auto',
): VoiceLike | undefined {
  const exact = voices.filter((voice) => sameAccent(voice, accent));
  if (exact.length === 0) return undefined;

  const gendered =
    gender === 'auto' ? exact : exact.filter((voice) => matchesGender(voice, gender));
  const pool = gendered.length > 0 ? gendered : exact;
  return pool.find(isHighQuality) ?? pool[0];
}

/**
 * Whether the requested gender exists for this accent. The UI uses this to say
 * "máy chưa cài giọng nam Anh–Mỹ" instead of quietly using a female voice.
 */
export function voiceAvailability(
  voices: readonly VoiceLike[],
  accent: 'en-US' | 'en-GB',
  gender: TtsVoice,
): VoiceAvailability {
  const exact = voices.filter((voice) => sameAccent(voice, accent));
  if (exact.length === 0) return 'none';
  if (gender === 'auto') return 'exact';
  return exact.some((voice) => matchesGender(voice, gender)) ? 'exact' : 'accent-only';
}

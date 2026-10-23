import { pickVoice, voiceAvailability, type VoiceLike } from '../voices';

const voices: VoiceLike[] = [
  { identifier: 'com.apple.voice.samantha', name: 'Samantha', language: 'en-US' },
  { identifier: 'com.apple.voice.daniel', name: 'Daniel', language: 'en-GB' },
  { identifier: 'com.apple.voice.karen', name: 'Karen', language: 'en-AU' },
];

describe('pickVoice', () => {
  it('selects a female voice for the requested accent', () => {
    expect(pickVoice(voices, 'en-US', 'female')?.name).toBe('Samantha');
  });

  it('selects a male voice for the requested accent', () => {
    expect(pickVoice(voices, 'en-GB', 'male')?.name).toBe('Daniel');
  });

  it('falls back to the accent when the gender is not installed', () => {
    // No male en-US voice exists in this fixture; the female one is used but
    // availability reports the fallback so the UI can say so.
    expect(pickVoice(voices, 'en-US', 'male')?.name).toBe('Samantha');
    expect(voiceAvailability(voices, 'en-US', 'male')).toBe('accent-only');
  });

  it('falls back to another accent voice when the gender is missing', () => {
    expect(pickVoice(voices, 'en-GB', 'female')?.name).toBe('Daniel');
    expect(voiceAvailability(voices, 'en-GB', 'female')).toBe('accent-only');
  });

  it('returns undefined when the accent is not installed at all', () => {
    expect(pickVoice([], 'en-US', 'female')).toBeUndefined();
    expect(voiceAvailability([], 'en-US', 'auto')).toBe('none');
  });

  it('prefers an enhanced voice when one is installed', () => {
    const enhanced: VoiceLike[] = [
      ...voices,
      {
        identifier: 'com.apple.voice.ava.premium',
        name: 'Ava',
        language: 'en-US',
        quality: 'premium',
      },
    ];
    expect(pickVoice(enhanced, 'en-US', 'female')?.name).toBe('Ava');
  });

  it('reports an exact match for auto', () => {
    expect(voiceAvailability(voices, 'en-US', 'auto')).toBe('exact');
  });
});

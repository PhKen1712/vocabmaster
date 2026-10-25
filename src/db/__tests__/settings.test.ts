import {
  DEFAULT_AI_MODEL,
  DEFAULT_GROQ_MODEL,
  DEFAULT_REVIEW_INTERVALS,
  DEFAULT_SETTINGS,
} from '../../types';
import {
  sanitizeAiModel,
  sanitizeAiProvider,
  sanitizeGroqModel,
  sanitizeReviewIntervals,
  sanitizeSettings,
} from '../settings';

describe('sanitizeAiModel', () => {
  it('replaces a model Google has retired', () => {
    expect(sanitizeAiModel('gemini-2.5-flash')).toBe(DEFAULT_AI_MODEL);
  });

  it('accepts the models/ prefix Google returns and keeps the bare name', () => {
    expect(sanitizeAiModel('models/gemini-3.8-flash')).toBe('gemini-3.8-flash');
  });

  it('keeps a model the user typed that is not known to be retired', () => {
    expect(sanitizeAiModel('gemini-9.0-pro')).toBe('gemini-9.0-pro');
  });

  it('falls back to the default for empty or non-string values', () => {
    expect(sanitizeAiModel('')).toBe(DEFAULT_AI_MODEL);
    expect(sanitizeAiModel('   ')).toBe(DEFAULT_AI_MODEL);
    expect(sanitizeAiModel(undefined)).toBe(DEFAULT_AI_MODEL);
    expect(sanitizeAiModel(42)).toBe(DEFAULT_AI_MODEL);
  });
});

describe('sanitizeSettings', () => {
  it('migrates settings saved by a build that shipped the retired model', () => {
    const settings = sanitizeSettings({ ...DEFAULT_SETTINGS, aiModel: 'gemini-2.5-flash' });

    expect(settings.aiModel).toBe(DEFAULT_AI_MODEL);
  });

  it('ships a default model that is not in the retired list', () => {
    expect(DEFAULT_SETTINGS.aiModel).toBe(DEFAULT_AI_MODEL);
    expect(DEFAULT_SETTINGS.aiModel).not.toContain('2.5');
  });

  it('sanitises the saved voice preference', () => {
    expect(sanitizeSettings({ ...DEFAULT_SETTINGS, ttsVoice: 'male' }).ttsVoice).toBe('male');
    expect(sanitizeSettings({ ...DEFAULT_SETTINGS, ttsVoice: 'female' }).ttsVoice).toBe('female');
    expect(sanitizeSettings({ ...DEFAULT_SETTINGS, ttsVoice: 'robot' }).ttsVoice).toBe('auto');
  });

  it('keeps both provider models while switching provider', () => {
    const settings = sanitizeSettings({
      ...DEFAULT_SETTINGS,
      aiProvider: 'groq',
      aiModel: 'gemini-9.0-pro',
      groqModel: 'openai/gpt-oss-20b',
    });

    expect(settings.aiProvider).toBe('groq');
    expect(settings.aiModel).toBe('gemini-9.0-pro');
    expect(settings.groqModel).toBe('openai/gpt-oss-20b');
  });

  it('defaults a settings row saved before Groq existed to Groq', () => {
    const settings = sanitizeSettings({ ...DEFAULT_SETTINGS, aiProvider: undefined, groqModel: undefined });
    expect(settings.aiProvider).toBe('groq');
    expect(settings.groqModel).toBe(DEFAULT_GROQ_MODEL);
  });

  it('gives a row saved before custom intervals the documented defaults', () => {
    const settings = sanitizeSettings({ ...DEFAULT_SETTINGS, reviewIntervals: undefined });
    expect(settings.reviewIntervals).toEqual(DEFAULT_REVIEW_INTERVALS);
    expect(settings.sfxEnabled).toBe(true);
    expect(settings.studyCycleId).toBe('initial');
  });

  it('clamps custom intervals to minutes and never allows zero', () => {
    const settings = sanitizeSettings({
      ...DEFAULT_SETTINGS,
      reviewIntervals: { again: 0, hard: -5, good: 5_000, easy: 10 },
    });
    expect(settings.reviewIntervals).toEqual({ again: 1, hard: 1, good: 5_000, easy: 10 });
  });

  it('keeps an explicit sound-effects preference and clamps its volume', () => {
    const off = sanitizeSettings({ ...DEFAULT_SETTINGS, sfxEnabled: false, sfxVolume: 4 });
    expect(off.sfxEnabled).toBe(false);
    expect(off.sfxVolume).toBe(1);
  });
});

describe('sanitizeReviewIntervals', () => {
  it('falls back per field instead of dropping the whole object', () => {
    expect(sanitizeReviewIntervals({ again: 7 })).toEqual({
      again: 7,
      hard: DEFAULT_REVIEW_INTERVALS.hard,
      good: DEFAULT_REVIEW_INTERVALS.good,
      easy: DEFAULT_REVIEW_INTERVALS.easy,
    });
  });
});

describe('sanitizeAiProvider', () => {
  it('accepts only the known providers', () => {
    expect(sanitizeAiProvider('groq')).toBe('groq');
    expect(sanitizeAiProvider('gemini')).toBe('gemini');
    expect(sanitizeAiProvider('openai')).toBe('groq');
    expect(sanitizeAiProvider(undefined)).toBe('groq');
  });
});

describe('sanitizeGroqModel', () => {
  it('falls back to the Groq default for a blank model', () => {
    expect(sanitizeGroqModel('  ')).toBe(DEFAULT_GROQ_MODEL);
    expect(sanitizeGroqModel(undefined)).toBe(DEFAULT_GROQ_MODEL);
  });

  it('keeps a model the user typed', () => {
    expect(sanitizeGroqModel(' openai/gpt-oss-20b ')).toBe('openai/gpt-oss-20b');
  });
});

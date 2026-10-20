import { DEFAULT_AI_MODEL, DEFAULT_SETTINGS } from '../../types';
import { sanitizeAiModel, sanitizeSettings } from '../settings';

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
});

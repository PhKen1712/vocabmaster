import type { AiSuggestion } from '../../ai/types';
import { applyExplanations } from '../explain';
import type { DictEntry } from '../types';

function entry(overrides: Partial<DictEntry> = {}): DictEntry {
  return {
    term: 'make a decision',
    normalized: 'make a decision',
    status: 'found',
    ipa: '/meɪk ə dɪˈsɪʒən/',
    audioUrl: 'https://example.test/decision.mp3',
    partOfSpeech: 'phrase',
    meaningVi: 'thi hành phán quyết',
    otherMeaningsVi: [],
    definitionEn: 'To execute a judicial ruling.',
    exampleEn: null,
    synonyms: [],
    antonyms: [],
    level: 2,
    levelSource: 'pack',
    sources: ['minhqnd'],
    aiFilled: [],
    missing: [],
    cached: false,
    attempts: 1,
    elapsedMs: 12,
    ...overrides,
  };
}

function suggestion(overrides: Partial<AiSuggestion> = {}): AiSuggestion {
  return {
    term: 'make a decision',
    partOfSpeech: 'phrase',
    meaningVi: 'đưa ra quyết định',
    definitionEn: 'To choose something after thinking about it.',
    exampleEn: 'We need to make a decision today.',
    exampleVi: 'Chúng ta cần đưa ra quyết định hôm nay.',
    synonyms: [],
    antonyms: [],
    collocations: [],
    wordFamily: [],
    topic: null,
    track: 'general',
    level: 2,
    ...overrides,
  } as AiSuggestion;
}

describe('applyExplanations', () => {
  it('replaces academic dictionary glosses with the everyday AI meaning', () => {
    const [merged] = applyExplanations([entry()], [suggestion()]);

    expect(merged?.meaningVi).toBe('đưa ra quyết định');
    expect(merged?.definitionEn).toBe('To choose something after thinking about it.');
    expect(merged?.otherMeaningsVi).toEqual(['thi hành phán quyết']);
    expect(merged?.aiFilled).toContain('meaningVi');
    expect(merged?.sources).toContain('gemini');
  });

  it('keeps verified dictionary IPA, audio and part of speech', () => {
    const [merged] = applyExplanations(
      [entry()],
      [suggestion({ ipa: '/bɒd/ɪ/', partOfSpeech: 'verb' })],
    );

    expect(merged?.ipa).toBe('/meɪk ə dɪˈsɪʒən/');
    expect(merged?.audioUrl).toBe('https://example.test/decision.mp3');
    expect(merged?.partOfSpeech).toBe('phrase');
    expect(merged?.aiFilled).not.toContain('ipa');
  });

  it('uses the model IPA only when the dictionary has none and it is wrapped', () => {
    const [merged] = applyExplanations(
      [entry({ ipa: null })],
      [suggestion({ ipa: '/ˈprəʊɡres/' })],
    );
    expect(merged?.ipa).toBe('/ˈprəʊɡres/');
    expect(merged?.aiFilled).toContain('ipa');

    const [bare] = applyExplanations([entry({ ipa: null })], [suggestion({ ipa: 'prəʊɡres' })]);
    expect(bare?.ipa).toBeNull();
  });

  it('matches AI terms case- and whitespace-insensitively', () => {
    const [merged] = applyExplanations(
      [entry()],
      [suggestion({ term: '  Make A Decision ' })],
    );
    expect(merged?.meaningVi).toBe('đưa ra quyết định');
  });

  it('leaves words the AI did not answer untouched', () => {
    const original = entry();
    const [untouched] = applyExplanations([original], [suggestion({ term: 'borrow' })]);

    expect(untouched).toEqual(original);
  });

  it('ignores an empty AI meaning and keeps the dictionary one', () => {
    const [merged] = applyExplanations([entry()], [suggestion({ meaningVi: '   ' })]);
    expect(merged?.meaningVi).toBe('thi hành phán quyết');
    expect(merged?.aiFilled).not.toContain('meaningVi');
  });
});

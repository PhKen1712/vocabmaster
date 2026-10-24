import { cleanTerm, parseWordList } from '../parse';
import { entryFromSuggestion, entryToWordInput, failedEntry } from '../types';

describe('word list parsing', () => {
  it('keeps phrases whole instead of splitting them into single words', () => {
    const parsed = parseWordList('take into account, in terms of, carry out an investigation');
    expect(parsed.terms).toEqual(['take into account', 'in terms of', 'carry out an investigation']);
    expect(parsed.dropped).toHaveLength(0);
  });

  it('trims, collapses inner spaces and drops empty items', () => {
    const parsed = parseWordList('  criminal ,,   civil  law ,\n');
    expect(parsed.terms).toEqual(['criminal', 'civil law']);
  });

  it('removes duplicates case-insensitively while keeping the first spelling', () => {
    const parsed = parseWordList('Criminal, criminal, CRIMINAL');
    expect(parsed.terms).toEqual(['Criminal']);
    expect(parsed.dropped.filter((item) => item.reason === 'duplicate')).toHaveLength(2);
  });

  it('does not treat a phrase as not-English', () => {
    expect(cleanTerm("  take   it  easy  ")).toBe('take it easy');
    expect(parseWordList('take it easy').terms).toEqual(['take it easy']);
  });

  it('reports items beyond the cap instead of silently forgetting them', () => {
    const parsed = parseWordList('one, two, three, four', 2);
    expect(parsed.terms).toEqual(['one', 'two']);
    expect(parsed.truncated).toBe(true);
  });
});

describe('list entries', () => {
  it('converts a Groq row into a word without losing the phrase', () => {
    const entry = entryFromSuggestion(
      'take into account',
      {
        term: 'take into account',
        meaningVi: 'cân nhắc, tính đến',
        partOfSpeech: 'phrase',
        exampleEn: 'We must take the cost into account.',
        exampleVi: 'Chúng ta phải tính đến chi phí.',
        source: 'ai',
        aiGenerated: true,
        confirmed: false,
        ipa: null,
      },
      { level: 3, levelSource: 'ai', cached: false },
    );
    const input = entryToWordInput(entry, { track: 'general', level: 2, topic: '' });
    expect(input?.term).toBe('take into account');
    expect(input?.level).toBe(3);
    expect(input?.meaningVi).toBe('cân nhắc, tính đến');
    expect(entry.status).toBe('ready');
  });

  it('refuses to save a failed row as if it had a meaning', () => {
    const failed = failedEntry('take into account', 'network');
    expect(failed.status).toBe('failed');
    expect(entryToWordInput(failed, { track: 'general', level: 2, topic: '' })).toBeNull();
  });
});

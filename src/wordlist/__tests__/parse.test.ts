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

describe('mixed-language lists', () => {
  it('makes one item per real newline, whatever the language', () => {
    const parsed = parseWordList(
      'criminal\ncivil\nenvironmental protection\nbảo vệ môi trường',
    );

    expect(parsed.terms).toEqual([
      'criminal',
      'civil',
      'environmental protection',
      'bảo vệ môi trường',
    ]);
    expect(parsed.items.map((item) => item.language)).toEqual(['en', 'en', 'en', 'vi']);
    expect(parsed.english).toEqual(['criminal', 'civil', 'environmental protection']);
    expect(parsed.vietnamese).toEqual(['bảo vệ môi trường']);
  });

  it('never splits a phrase on spaces — a wrapped line is still one item', () => {
    expect(parseWordList('carry out an investigation').terms).toEqual([
      'carry out an investigation',
    ]);
    expect(parseWordList('bảo vệ môi trường').terms).toEqual(['bảo vệ môi trường']);
  });

  it('skips blank lines and understands Windows line endings', () => {
    const parsed = parseWordList('criminal\r\n\r\n  \r\nbảo vệ môi trường\r\n');

    expect(parsed.terms).toEqual(['criminal', 'bảo vệ môi trường']);
    expect(parsed.vietnamese).toEqual(['bảo vệ môi trường']);
  });

  it('keeps Vietnamese diacritics exactly as the learner typed them', () => {
    expect(parseWordList('trách nhiệm dân sự').terms).toEqual(['trách nhiệm dân sự']);
  });

  it('still accepts a comma-separated line and still removes duplicates', () => {
    expect(parseWordList('criminal, civil, civil').terms).toEqual(['criminal', 'civil']);
  });

  it('reports an item that is neither English nor Vietnamese instead of guessing', () => {
    const parsed = parseWordList('12345');
    expect(parsed.terms).toEqual([]);
    expect(parsed.dropped[0]).toEqual({ value: '12345', reason: 'not_a_word' });
  });

  it('saves the Vietnamese original next to the English term Groq chose', () => {
    const englishOptions = ['civil liability', 'civil responsibility'];
    const entry = entryFromSuggestion(
      'civil liability',
      {
        term: 'civil liability',
        meaningVi: 'trách nhiệm dân sự',
        partOfSpeech: 'phrase',
        source: 'ai',
        aiGenerated: true,
        confirmed: false,
        ipa: null,
        sourceVi: 'trách nhiệm dân sự',
        englishOptions,
        uncertain: false,
      },
      {
        level: 4,
        levelSource: 'ai',
        cached: false,
        key: 'trách nhiệm dân sự',
        language: 'vi',
        translation: {
          sourceTerm: 'trách nhiệm dân sự',
          englishOptions,
          uncertain: false,
        },
      },
    );

    // The row is addressed by what the learner typed, but saved as English.
    expect(entry.normalized).toBe('trách nhiệm dân sự');
    expect(entry.term).toBe('civil liability');
    expect(entry.englishOptions).toEqual(englishOptions);

    const input = entryToWordInput(entry, { track: 'general', level: 2, topic: '' });
    expect(input?.term).toBe('civil liability');
    expect(input?.note).toBe('Gốc: trách nhiệm dân sự');
  });
});

import { extractJson, looksTruncated, parseSuggestions, repairTruncatedJson } from '../schema';
import type { AiRequest } from '../types';

function request(overrides: Partial<AiRequest> = {}): AiRequest {
  return {
    track: 'general',
    level: 2,
    count: 2,
    avoidTerms: [],
    weakTerms: [],
    ...overrides,
  };
}

function word(overrides: Record<string, unknown> = {}) {
  return {
    term: 'borrow',
    meaningVi: 'mượn',
    partOfSpeech: 'verb',
    level: 2,
    ipa: '/ˈbɒr.əʊ/',
    exampleEn: 'Can I borrow your pen?',
    exampleVi: 'Tớ mượn bút của cậu được không?',
    ...overrides,
  };
}

describe('parseSuggestions', () => {
  it('accepts a clean item without warnings', () => {
    const result = parseSuggestions({ words: [word()] }, request());
    expect(result.suggestions).toHaveLength(1);
    expect(result.rejected).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.suggestions[0]).toMatchObject({
      term: 'borrow',
      meaningVi: 'mượn',
      partOfSpeech: 'verb',
      level: 2,
      track: 'general',
      aiGenerated: true,
      confirmed: false,
    });
  });

  it('rejects an item that duplicates a word already in the database', () => {
    const result = parseSuggestions({ words: [word()] }, request({ avoidTerms: ['Borrow'] }));
    expect(result.suggestions).toHaveLength(0);
    expect(result.rejected[0]).toContain('trùng');
  });

  it('rejects duplicates inside the same response', () => {
    const result = parseSuggestions(
      { words: [word(), word({ term: 'Borrow ' })] },
      request({ avoidTerms: [] }),
    );
    expect(result.suggestions).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
  });

  it('rejects an item without a Vietnamese meaning instead of saving half a word', () => {
    const result = parseSuggestions({ words: [word({ meaningVi: '   ' })] }, request());
    expect(result.suggestions).toHaveLength(0);
    expect(result.rejected[0]).toContain('nghĩa tiếng Việt');
  });

  it('keeps the word but drops an IPA that is not wrapped in slashes', () => {
    const result = parseSuggestions({ words: [word({ ipa: 'bor-oh' })] }, request());
    expect(result.suggestions[0]?.ipa).toBeNull();
    expect(result.warnings[0]).toContain('IPA');
  });

  it('warns about an unknown part of speech but does not throw the word away', () => {
    const result = parseSuggestions({ words: [word({ partOfSpeech: 'gerundive' })] }, request());
    expect(result.suggestions[0]?.partOfSpeech).toBe('gerundive');
    expect(result.warnings.some((item) => item.includes('từ loại'))).toBe(true);
  });

  it('flags an example that does not contain the target term', () => {
    const result = parseSuggestions(
      { words: [word({ exampleEn: 'She lent me a book.' })] },
      request(),
    );
    expect(result.suggestions).toHaveLength(1);
    expect(result.warnings.some((item) => item.includes('ví dụ'))).toBe(true);
  });

  it('flags a word far above the requested level', () => {
    const result = parseSuggestions({ words: [word({ level: 6 })] }, request({ level: 1 }));
    expect(result.warnings.some((item) => item.includes('cấp độ'))).toBe(true);
  });

  it('keeps the per-item level Groq judged even when it is below the requested level', () => {
    const result = parseSuggestions(
      { words: [word({ term: 'abandon', level: 3, meaningVi: 'từ bỏ' })] },
      request({ level: 4 }),
    );
    expect(result.suggestions[0]?.level).toBe(3);
    expect(result.suggestions[0]?.levelSource).toBe('ai');
  });

  it('marks a missing level as a requested fallback, not an AI judgement', () => {
    const result = parseSuggestions(
      { words: [word({ term: 'abandon', level: undefined, meaningVi: 'từ bỏ' })] },
      request({ level: 4 }),
    );
    expect(result.suggestions[0]?.level).toBe(4);
    expect(result.suggestions[0]?.levelSource).toBe('requested');
    expect(result.warnings.some((item) => item.includes('không gắn cấp độ'))).toBe(true);
  });

  it('flags an untranslated meaning', () => {
    const result = parseSuggestions({ words: [word({ meaningVi: 'borrow' })] }, request());
    expect(result.warnings.some((item) => item.includes('chưa được dịch'))).toBe(true);
  });

  it('reports a missing words array instead of crashing', () => {
    const result = parseSuggestions({ items: [] }, request());
    expect(result.suggestions).toHaveLength(0);
    expect(result.rejected[0]).toContain('words');
  });
});

describe('parseSuggestions for Vietnamese items', () => {
  const vi = { sourceVi: 'trách nhiệm dân sự', meaningVi: 'trách nhiệm dân sự' };

  it('keeps the learner’s Vietnamese next to the English term Groq chose', () => {
    const result = parseSuggestions(
      {
        words: [
          word({
            term: 'civil liability',
            ...vi,
            meaningVi: 'trách nhiệm dân sự',
            englishOptions: ['civil liability', 'civil responsibility'],
            uncertain: false,
          }),
        ],
      },
      request({ translateFromVi: true }),
    );

    expect(result.suggestions[0]?.term).toBe('civil liability');
    expect(result.suggestions[0]?.sourceVi).toBe('trách nhiệm dân sự');
    expect(result.suggestions[0]?.englishOptions).toEqual([
      'civil liability',
      'civil responsibility',
    ]);
  });

  it('always lists the saved term first, even if the model did not', () => {
    const result = parseSuggestions(
      { words: [word({ term: 'civil liability', ...vi, englishOptions: ['civil responsibility'] })] },
      request({ translateFromVi: true }),
    );

    expect(result.suggestions[0]?.englishOptions).toEqual([
      'civil liability',
      'civil responsibility',
    ]);
  });

  it('warns when the model echoed the Vietnamese instead of translating it', () => {
    const result = parseSuggestions(
      { words: [word({ term: 'trách nhiệm dân sự', sourceVi: 'trách nhiệm dân sự' })] },
      request({ translateFromVi: true }),
    );

    expect(result.warnings.some((line) => line.includes('chưa có từ tiếng Anh'))).toBe(true);
  });

  it('flags an uncertain translation instead of hiding it', () => {
    const result = parseSuggestions(
      { words: [word({ term: 'civil liability', sourceVi: 'trách nhiệm dân sự', uncertain: true })] },
      request({ translateFromVi: true }),
    );

    expect(result.suggestions[0]?.uncertain).toBe(true);
    expect(result.warnings.some((line) => line.includes('không chắc'))).toBe(true);
  });

  it('ignores translation-only fields for a plain English request', () => {
    const result = parseSuggestions(
      { words: [word({ sourceVi: 'trách nhiệm dân sự', englishOptions: ['borrow'] })] },
      request(),
    );

    expect(result.suggestions[0]?.sourceVi).toBeNull();
    expect(result.suggestions[0]?.englishOptions).toEqual([]);
  });
});

describe('extractJson', () => {
  it('reads plain JSON', () => {
    expect(extractJson('{"words":[]}')).toEqual({ words: [] });
  });

  it('reads JSON inside a code fence', () => {
    expect(extractJson('```json\n{"words":[{"term":"a"}]}\n```')).toEqual({
      words: [{ term: 'a' }],
    });
  });

  it('returns null for text that is not JSON at all', () => {
    expect(extractJson('Sorry, I cannot do that.')).toBeNull();
    expect(extractJson('')).toBeNull();
  });

  it('detects a response cut off mid-object', () => {
    expect(looksTruncated('{"words":[{"term":"borrow"')).toBe(true);
    expect(looksTruncated('{"words":[]}')).toBe(false);
  });
});

describe('truncated output', () => {
  const cut =
    '{"words":[{"term":"borrow","meaningVi":"mượn","partOfSpeech":"verb","level":2},' +
    '{"term":"lend","meaningVi":"cho mượn","partOf';

  it('salvages the complete items instead of losing the whole batch', () => {
    const repaired = repairTruncatedJson(cut) as { words: unknown[] } | null;
    expect(repaired).not.toBeNull();
    expect(repaired?.words).toHaveLength(1);

    const parsed = extractJson(cut);
    expect(parsed).toEqual({ words: [{ term: 'borrow', meaningVi: 'mượn', partOfSpeech: 'verb', level: 2 }] });
  });

  it('turns the salvaged items into usable suggestions', () => {
    const result = parseSuggestions(extractJson(cut), request());
    expect(result.suggestions.map((item) => item.term)).toEqual(['borrow']);
  });
});

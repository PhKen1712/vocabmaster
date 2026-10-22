import { MAX_LIST_WORDS, cleanTerm, parseWordList } from '../list';

describe('parseWordList', () => {
  it('trims, collapses spaces, drops empty items and duplicates', () => {
    const result = parseWordList('criminal, civil,  justice, evidence,, criminal');
    expect(result.terms).toEqual(['criminal', 'civil', 'justice', 'evidence']);
    expect(result.dropped).toEqual([{ value: 'criminal', reason: 'duplicate' }]);
    expect(result.truncated).toBe(false);
  });

  it('dedupes case-insensitively and keeps the first spelling', () => {
    const result = parseWordList('Criminal, criminal, CRIMINAL');
    expect(result.terms).toEqual(['Criminal']);
    expect(result.dropped).toHaveLength(2);
  });

  it('keeps multi-word items together and normalizes their spaces', () => {
    const result = parseWordList('civil    law ,  take   off ');
    expect(result.terms).toEqual(['civil law', 'take off']);
  });

  it('accepts one word per line as well as commas', () => {
    const result = parseWordList('criminal\ncivil\nevidence');
    expect(result.terms).toEqual(['criminal', 'civil', 'evidence']);
  });

  it('returns an empty list for blank input', () => {
    expect(parseWordList('   ,\n , ').terms).toEqual([]);
    expect(parseWordList('').terms).toEqual([]);
  });

  it('reports items it cannot look up instead of silently keeping them', () => {
    const result = parseWordList('criminal, 123, evidence');
    expect(result.terms).toEqual(['criminal', 'evidence']);
    expect(result.dropped).toEqual([{ value: '123', reason: 'not_english' }]);
  });

  it('caps the batch and says so', () => {
    const input = Array.from(
      { length: MAX_LIST_WORDS + 5 },
      (_, index) => `term${'a'.repeat(index + 1)}`,
    ).join(', ');
    const result = parseWordList(input);
    expect(result.terms).toHaveLength(MAX_LIST_WORDS);
    expect(result.truncated).toBe(true);
  });

  it('cleanTerm strips wrapping quotes and unifies curly apostrophes', () => {
    expect(cleanTerm('  “don’t”  ')).toBe("don't");
  });
});

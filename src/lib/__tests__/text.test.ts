import { levenshtein, normalizeAnswer, normalizeTerm, parseCsv, splitList, tokenize } from '../text';

describe('text helpers', () => {
  it('normalizes terms for duplicate detection', () => {
    expect(normalizeTerm('  Get   Along With ')).toBe('get along with');
    expect(normalizeTerm('Don’t')).toBe("don't");
  });

  it('normalizes answers without changing meaning', () => {
    expect(normalizeAnswer('  The Deadline! ')).toBe('deadline');
    expect(normalizeAnswer('To borrow')).toBe('borrow');
    expect(normalizeAnswer('a helpful person')).toBe('helpful person');
  });

  it('computes edit distance', () => {
    expect(levenshtein('borrow', 'borrow')).toBe(0);
    expect(levenshtein('borrow', 'borow')).toBe(1);
    expect(levenshtein('', 'abc')).toBe(3);
  });

  it('tokenizes sentences for speaking practice', () => {
    expect(tokenize('I get along with my roommate.')).toEqual([
      'i',
      'get',
      'along',
      'with',
      'my',
      'roommate',
    ]);
  });

  it('parses quoted CSV with commas and CRLF', () => {
    const csv = 'term,meaning\r\n"borrow","mượn, rồi trả"\r\nlend,cho mượn\r\n';
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual(['borrow', 'mượn, rồi trả']);
    expect(rows[2]).toEqual(['lend', 'cho mượn']);
  });

  it('handles escaped quotes and trailing empty lines', () => {
    const rows = parseCsv('term,note\n"say ""hello""",ok\n\n');
    expect(rows[1]).toEqual(['say "hello"', 'ok']);
  });

  it('splits and de-duplicates list fields', () => {
    expect(splitList('borrow, lend; borrow | loan')).toEqual(['borrow', 'lend', 'loan']);
    expect(splitList('')).toEqual([]);
  });
});

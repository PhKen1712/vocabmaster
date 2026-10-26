import { detectLanguage, hasVietnameseMarks, splitByLanguage } from '../lang';

describe('detectLanguage', () => {
  it('recognises English words, phrases and capitalisation', () => {
    expect(detectLanguage('criminal')).toBe('en');
    expect(detectLanguage('take into account')).toBe('en');
    expect(detectLanguage("don't give up")).toBe('en');
    expect(detectLanguage('  Environmental   protection ')).toBe('en');
  });

  it('recognises Vietnamese from its own letters', () => {
    expect(detectLanguage('bảo vệ môi trường')).toBe('vi');
    expect(detectLanguage('đường')).toBe('vi');
    expect(detectLanguage('trách nhiệm dân sự')).toBe('vi');
  });

  it('recognises Vietnamese from a tone mark alone', () => {
    expect(hasVietnameseMarks('môi trường')).toBe(true);
    expect(detectLanguage('kế toán')).toBe('vi');
    expect(detectLanguage('trường học')).toBe('vi');
  });

  it('returns unknown for text that is neither language', () => {
    expect(detectLanguage('12345')).toBe('unknown');
    expect(detectLanguage('   ')).toBe('unknown');
    expect(detectLanguage('🙂🙂')).toBe('unknown');
  });

  it('labels each item of a mixed list independently, never the list as a whole', () => {
    const items = [
      { value: 'criminal', language: detectLanguage('criminal') },
      { value: 'trách nhiệm dân sự', language: detectLanguage('trách nhiệm dân sự') },
      { value: 'environmental protection', language: detectLanguage('environmental protection') },
      { value: 'bảo vệ môi trường', language: detectLanguage('bảo vệ môi trường') },
    ] as const;

    const split = splitByLanguage([...items]);
    expect(split.english.map((item) => item.value)).toEqual([
      'criminal',
      'environmental protection',
    ]);
    expect(split.vietnamese.map((item) => item.value)).toEqual([
      'trách nhiệm dân sự',
      'bảo vệ môi trường',
    ]);
  });
});

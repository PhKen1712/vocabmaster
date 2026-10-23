import type { Word } from '../../types';
import { generateQuestions, makeClozeSentence, shuffle } from '../generator';
import { compareSpokenWords, gradeAnswer } from '../grading';

function makeWord(overrides: Partial<Word> & Pick<Word, 'id' | 'term' | 'meaningVi'>): Word {
  return {
    normalizedTerm: overrides.term.toLowerCase(),
    ipa: null,
    partOfSpeech: 'noun',
    definitionEn: `definition of ${overrides.term}`,
    exampleEn: null,
    exampleVi: null,
    synonyms: [],
    antonyms: [],
    collocations: [],
    wordFamily: [],
    topic: 'Test',
    track: 'general',
    level: 2,
    source: 'manual',
    aiGenerated: false,
    confirmed: true,
    note: null,
    audioUrl: null,
    isFavorite: false,
    learningState: 'new',
    dueAt: null,
    stability: 0,
    difficulty: 0,
    reps: 0,
    lapses: 0,
    lastReviewedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const words: Word[] = [
  makeWord({ id: '1', term: 'borrow', meaningVi: 'mượn' }),
  makeWord({ id: '2', term: 'lend', meaningVi: 'cho mượn' }),
  makeWord({ id: '3', term: 'crowded', meaningVi: 'đông đúc', partOfSpeech: 'adjective' }),
  makeWord({ id: '4', term: 'helpful', meaningVi: 'hay giúp đỡ', partOfSpeech: 'adjective' }),
  makeWord({ id: '5', term: 'deadline', meaningVi: 'hạn chót' }),
  makeWord({ id: '6', term: 'afford', meaningVi: 'đủ khả năng chi trả' }),
];

const rng = () => 0.42;

describe('quiz generator', () => {
  it('builds options that include the answer and no duplicate labels', () => {
    const [question] = generateQuestions([words[0]!], words, {
      kinds: ['en_to_vi'],
      rng,
    });
    expect(question).toBeDefined();
    expect(question?.options).not.toBeNull();
    const options = question?.options ?? [];
    expect(options.some((option) => option.id === '1')).toBe(true);
    const labels = options.map((option) => option.label.toLowerCase());
    expect(new Set(labels).size).toBe(labels.length);
    expect(options.length).toBeGreaterThanOrEqual(2);
    expect(options.length).toBeLessThanOrEqual(4);
  });

  it('falls back to a typed question when no distractor exists', () => {
    const [question] = generateQuestions([words[0]!], [words[0]!], {
      kinds: ['en_to_vi'],
      rng,
    });
    expect(question?.options).toBeNull();
    expect(question?.kind).toBe('typing');
    expect(question?.accepted).toContain('borrow');
  });

  it('creates a cloze sentence only when the example contains the word', () => {
    const withExample = makeWord({
      id: '7',
      term: 'borrow',
      meaningVi: 'mượn',
      exampleEn: 'Can I borrow your pen?',
    });
    expect(makeClozeSentence(withExample)).toBe('Can I _____ your pen?');
    expect(makeClozeSentence(words[0]!)).toBeNull();
  });

  it('does not build a cloze question without an example', () => {
    const [question] = generateQuestions([words[0]!], words, {
      kinds: ['cloze'],
      rng,
    });
    expect(question?.kind).not.toBe('cloze');
    expect(question).toBeDefined();
  });

  it('never returns more questions than requested', () => {
    const questions = generateQuestions(words, words, { limit: 2, rng });
    expect(questions).toHaveLength(2);
    expect(new Set(questions.map((q) => q.wordId)).size).toBe(2);
  });

  it('shuffles deterministically for a fixed rng', () => {
    const a = shuffle([1, 2, 3, 4, 5], rng);
    const b = shuffle([1, 2, 3, 4, 5], rng);
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('grading', () => {
  const [enToVi] = generateQuestions([words[0]!], words, { kinds: ['en_to_vi'], rng });
  const [typing] = generateQuestions([words[0]!], words, { kinds: ['typing'], rng });

  it('grades option questions by id, not by label text', () => {
    expect(gradeAnswer(enToVi!, { optionId: enToVi!.answerId }).correct).toBe(true);
    expect(gradeAnswer(enToVi!, { optionId: 'wrong-id' }).correct).toBe(false);
    expect(gradeAnswer(enToVi!, { optionId: null }).correct).toBe(false);
  });

  it('ignores case, punctuation and surrounding spaces for typed answers', () => {
    expect(gradeAnswer(typing!, { text: '  Borrow. ' }).correct).toBe(true);
    expect(gradeAnswer(typing!, { text: 'BORROW' }).correct).toBe(true);
    expect(gradeAnswer(typing!, { text: 'borowed' }).correct).toBe(false);
  });

  it('reports a one-letter spelling mistake as a near miss, not correct', () => {
    const result = gradeAnswer(typing!, { text: 'borow' });
    expect(result.correct).toBe(false);
    expect(result.nearMiss).toBe(true);
  });

  it('accepts "to" verbs with or without the particle', () => {
    const verb = makeWord({ id: '8', term: 'to borrow', meaningVi: 'mượn' });
    const [question] = generateQuestions([verb], [...words, verb], {
      kinds: ['typing'],
      rng,
    });
    expect(gradeAnswer(question!, { text: 'borrow' }).correct).toBe(true);
    expect(gradeAnswer(question!, { text: 'to borrow' }).correct).toBe(true);
  });

  it('compares spoken words without inventing a pronunciation score', () => {
    const comparison = compareSpokenWords('get along with', 'get along');
    expect(comparison.matched).toEqual(['get', 'along']);
    expect(comparison.expected).toHaveLength(3);
  });

  it('accepts a stored synonym when the question asks for meaning', () => {
    const smart = makeWord({
      id: '9',
      term: 'intelligent',
      meaningVi: 'thông minh',
      synonyms: ['smart', 'clever', 'bright'],
    });
    const [question] = generateQuestions([smart], [...words, smart], {
      kinds: ['typing'],
      rng,
    });
    expect(gradeAnswer(question!, { text: 'smart' }).correct).toBe(true);
    expect(gradeAnswer(question!, { text: 'Clever' }).correct).toBe(true);
    expect(gradeAnswer(question!, { text: 'slow' }).correct).toBe(false);
  });

  it('keeps spelling and listening questions strict about synonyms', () => {
    const smart = makeWord({
      id: '10',
      term: 'intelligent',
      meaningVi: 'thông minh',
      synonyms: ['smart'],
      exampleEn: 'She is an intelligent student.',
    });
    const [cloze] = generateQuestions([smart], [...words, smart], {
      kinds: ['cloze'],
      rng,
    });
    expect(cloze?.options?.some((option) => option.label === 'intelligent')).toBe(true);
    expect(cloze?.accepted).not.toContain('smart');
  });
});

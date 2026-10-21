import type { Level, Word } from '../../types';
import { buildPlacementQuestions, isAnswerable, recommendLevel } from '../placement';

function makeWord(
  overrides: Partial<Word> & Pick<Word, 'id' | 'term' | 'meaningVi' | 'level'>,
): Word {
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

const levels: Level[] = [0, 1, 2, 3, 4, 5, 6];
const pool: Word[] = levels.flatMap((level) => [
  makeWord({ id: `w${level}a`, term: `word${level}a`, meaningVi: `nghĩa ${level} a`, level }),
  makeWord({ id: `w${level}b`, term: `word${level}b`, meaningVi: `nghĩa ${level} b`, level }),
  makeWord({ id: `w${level}c`, term: `word${level}c`, meaningVi: `nghĩa ${level} c`, level }),
]);

const rng = () => 0.42;

describe('buildPlacementQuestions', () => {
  it('returns one question per available level, easiest first', () => {
    const questions = buildPlacementQuestions(pool, rng);
    expect(questions.map((question) => question.word.level)).toEqual(levels);
  });

  it('never returns a question without selectable options', () => {
    const questions = buildPlacementQuestions(pool, rng);
    expect(questions.length).toBeGreaterThan(0);
    for (const question of questions) {
      expect(question.options).not.toBeNull();
      expect(question.options?.length).toBeGreaterThanOrEqual(2);
      expect(question.kind === 'en_to_vi' || question.kind === 'vi_to_en').toBe(true);
      // The correct answer must be one of the options.
      expect(question.options?.some((option) => option.id === question.answerId)).toBe(true);
    }
  });

  it('skips a level instead of producing a question the screen cannot render', () => {
    // A single word cannot supply two distinct options, and the generator's
    // typing fallback has no options at all.
    const lonely = buildPlacementQuestions(
      [makeWord({ id: 'only', term: 'solo', meaningVi: 'một mình', level: 2 })],
      rng,
    );
    expect(lonely).toEqual([]);
  });

  it('reports whether a question is answerable', () => {
    const [question] = buildPlacementQuestions(pool, rng);
    expect(isAnswerable(question)).toBe(true);
    expect(isAnswerable(null)).toBe(false);
    expect(
      isAnswerable({
        ...question!,
        options: [],
      }),
    ).toBe(false);
  });
});

describe('recommendLevel', () => {
  it('maps the ratio to a starting level', () => {
    expect(recommendLevel(6, 6)).toBe(5);
    expect(recommendLevel(5, 6)).toBe(4);
    expect(recommendLevel(4, 6)).toBe(3);
    expect(recommendLevel(3, 6)).toBe(2);
    expect(recommendLevel(2, 6)).toBe(1);
    expect(recommendLevel(1, 6)).toBe(0);
  });

  it('falls back to A1 when nothing was answered', () => {
    expect(recommendLevel(0, 0)).toBe(1);
  });
});

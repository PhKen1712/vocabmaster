import type { Word } from '../../types';
import { isForgettable, priorityScore, sortWordsByPriority } from '../priority';

const NOW = new Date('2026-10-26T10:00:00.000Z').getTime();

function word(overrides: Partial<Word> = {}): Word {
  return {
    id: 'w1',
    term: 'borrow',
    normalizedTerm: 'borrow',
    ipa: null,
    partOfSpeech: 'verb',
    meaningVi: 'mượn',
    definitionEn: null,
    exampleEn: null,
    exampleVi: null,
    synonyms: [],
    antonyms: [],
    collocations: [],
    wordFamily: [],
    topic: null,
    track: 'general',
    level: 2,
    source: 'manual',
    aiGenerated: false,
    confirmed: true,
    note: null,
    audioUrl: null,
    isFavorite: false,
    learningState: 'review',
    dueAt: null,
    stability: 10,
    difficulty: 5,
    reps: 3,
    lapses: 0,
    correctCount: 3,
    wrongCount: 0,
    hintCount: 0,
    lastCorrectAt: null,
    lastWrongAt: null,
    memoryRating: null,
    lastReviewedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('study priority', () => {
  it('puts a due word ahead of an equally weak word that is not due', () => {
    const due = word({ dueAt: new Date(NOW - 3_600_000).toISOString() });
    const future = word({ id: 'w2', dueAt: new Date(NOW + 86_400_000).toISOString() });
    expect(priorityScore(due, NOW)).toBeGreaterThan(priorityScore(future, NOW));
  });

  it('raises frequently wrong words and lowers recently correct ones', () => {
    const wrong = word({ wrongCount: 8, correctCount: 2, lastWrongAt: new Date(NOW).toISOString() });
    const easy = word({
      id: 'w2',
      wrongCount: 0,
      correctCount: 10,
      lastCorrectAt: new Date(NOW - 60_000).toISOString(),
    });
    expect(priorityScore(wrong, NOW)).toBeGreaterThan(priorityScore(easy, NOW));
  });

  it('respects a low self-rating and hint use', () => {
    const low = word({ memoryRating: 1, hintCount: 5 });
    const high = word({ id: 'w2', memoryRating: 4 });
    expect(priorityScore(low, NOW)).toBeGreaterThan(priorityScore(high, NOW));
  });

  it('sorts highest priority first without mutating the input', () => {
    const words = [
      word({ id: 'a', dueAt: new Date(NOW + 86_400_000).toISOString() }),
      word({ id: 'b', dueAt: new Date(NOW - 1_000).toISOString() }),
    ];
    expect(sortWordsByPriority(words, NOW).map((item) => item.id)).toEqual(['b', 'a']);
    expect(words.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('only calls a studied word forgettable', () => {
    expect(isForgettable(word({ reps: 0, wrongCount: 0 }))).toBe(false);
    expect(isForgettable(word({ reps: 1, wrongCount: 2 }))).toBe(true);
    expect(isForgettable(word({ reps: 4, wrongCount: 0, memoryRating: 2 }))).toBe(true);
  });
});

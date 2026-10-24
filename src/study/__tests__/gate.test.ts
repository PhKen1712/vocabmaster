import type { SQLiteDatabase } from 'expo-sqlite';

import {
  assertNewLearningAllowed,
  countDueWords,
  getStudyGate,
  requiresReviewsComplete,
  ReviewsDueError,
} from '../gate';

function fakeDb(due: number): SQLiteDatabase {
  return {
    getFirstAsync: jest.fn(async () => ({ count: due })),
  } as unknown as SQLiteDatabase;
}

describe('review gate', () => {
  it('counts only words that are due and already studied', async () => {
    const db = fakeDb(4);
    expect(await countDueWords(db, 'general')).toBe(4);
    expect(await getStudyGate(db, 'general')).toEqual({
      dueCount: 4,
      newLearningBlocked: true,
    });
  });

  it('blocks a new-learning session and reports how many reviews are waiting', async () => {
    const db = fakeDb(3);
    await expect(assertNewLearningAllowed(db, 'general')).rejects.toMatchObject({
      name: 'ReviewsDueError',
      dueCount: 3,
    });
    expect(new ReviewsDueError(3).message).toContain('3 từ cần ôn');
    expect(new ReviewsDueError(3).message).not.toContain('thêm từ');
  });

  it('never limits adding or generating vocabulary, only starting to learn it', () => {
    // Adding a word to the bank is collecting, not studying: it must always be
    // allowed, even with reviews pending.
    expect(requiresReviewsComplete('addVocabulary')).toBe(false);
    expect(requiresReviewsComplete('generateContent')).toBe(false);
    expect(requiresReviewsComplete('startReview')).toBe(false);
    expect(requiresReviewsComplete('practiceKnown')).toBe(false);
    expect(requiresReviewsComplete('startNewLearning')).toBe(true);
  });

  it('opens the gate only when no word is due', async () => {
    const db = fakeDb(0);
    expect(await getStudyGate(db, 'ielts')).toEqual({
      dueCount: 0,
      newLearningBlocked: false,
    });
    await expect(assertNewLearningAllowed(db, 'ielts')).resolves.toBeUndefined();
  });
});

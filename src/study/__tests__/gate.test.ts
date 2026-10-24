import type { SQLiteDatabase } from 'expo-sqlite';

import {
  assertNewLearningAllowed,
  countDueWords,
  getStudyGate,
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

  it('blocks a new word and reports how many reviews are waiting', async () => {
    const db = fakeDb(3);
    await expect(assertNewLearningAllowed(db, 'general')).rejects.toMatchObject({
      name: 'ReviewsDueError',
      dueCount: 3,
    });
    expect(new ReviewsDueError(3).message).toContain('3 từ cần ôn');
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

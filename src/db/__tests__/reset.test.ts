import type { SQLiteDatabase } from 'expo-sqlite';

import { resetStudyProgress } from '../reset';

function fakeDb() {
  const statements: string[] = [];
  const db = {
    getFirstAsync: jest.fn(async () => ({ count: 12 })),
    execAsync: jest.fn(async (sql: string) => {
      statements.push(sql);
    }),
    runAsync: jest.fn(async (sql: string) => {
      statements.push(sql);
      return { changes: 5 };
    }),
    withTransactionAsync: jest.fn(async (fn: () => Promise<void>) => {
      await fn();
    }),
  } as unknown as SQLiteDatabase;
  return { db, statements };
}

describe('resetStudyProgress', () => {
  it('clears reviews, SRS state and counters', async () => {
    const { db, statements } = fakeDb();
    const result = await resetStudyProgress(db);

    expect(result).toEqual({ wordsReset: 5, reviewsDeleted: 12 });
    const sql = statements.join('\n');
    expect(sql).toContain('DELETE FROM reviews;');
    expect(sql).toContain('DELETE FROM word_study_history;');
    expect(sql).toContain('UPDATE words SET');
    expect(sql).toContain('learning_state = \'new\'');
    expect(sql).toContain('wrong_count = 0');
    expect(sql).toContain('memory_rating = NULL');
  });

  it('never deletes the library, album, coins, streak or settings', async () => {
    const { db, statements } = fakeDb();
    await resetStudyProgress(db);
    const sql = statements.join('\n');
    expect(sql).not.toMatch(/DELETE FROM words/);
    expect(sql).not.toContain('DELETE FROM album_words');
    expect(sql).not.toContain('DELETE FROM coin_ledger');
    expect(sql).not.toContain('DELETE FROM daily_activity');
    expect(sql).not.toContain('DELETE FROM streak_restores');
    expect(sql).not.toContain('DELETE FROM app_settings');
  });

  it('runs inside one transaction so a failure cannot leave half a reset', async () => {
    const { db } = fakeDb();
    await resetStudyProgress(db);
    expect((db.withTransactionAsync as jest.Mock).mock.calls).toHaveLength(1);
  });
});

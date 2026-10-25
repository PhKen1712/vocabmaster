import type { SQLiteDatabase } from 'expo-sqlite';

import {
  ensureWordStudied,
  getCoinBalance,
  getWordStudyState,
  hasRewardForTerm,
  isFirstRewardEligible,
  penalizeWordInTransaction,
  resetCoins,
  rewardWordInTransaction,
  wordTermKey,
} from '../ledger';

interface Row {
  id: string;
  kind: string;
  word_id: string | null;
  term_key: string | null;
  source_id: string | null;
  amount: number;
  balance_after: number;
  reason: string | null;
  created_at: string;
  cycle_id?: string;
}

function normalize(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

/** Tiny database double that understands only the ledger statements. */
class FakeDb {
  rows: Row[] = [];
  history = new Map<
    string,
    { term_key: string; first_studied_at: string; first_correct_at: string | null; rewarded_at: string | null }
  >();

  async getFirstAsync<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    const statement = normalize(sql);
    if (statement.includes('FROM word_study_history')) {
      return (this.history.get(String(params[0])) as T) ?? null;
    }
    if (statement.includes('COALESCE(SUM(amount)')) {
      const balance = this.rows.reduce((sum, row) => sum + row.amount, 0);
      return { balance } as T;
    }
    if (statement.includes('source_id = ?')) {
      return (this.rows.find((row) => row.source_id === params[0]) as T) ?? null;
    }
    if (statement.includes("kind = 'reward' AND (term_key = ? OR word_id = ?)")) {
      const cycle = params[2] === undefined ? 'initial' : String(params[2]);
      const found = this.rows.find(
        (row) =>
          row.kind === 'reward' &&
          (row.term_key === params[0] || row.word_id === params[1]) &&
          (row.cycle_id ?? 'initial') === cycle,
      );
      return (found as T) ?? null;
    }
    return null;
  }

  async runAsync(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
    const statement = normalize(sql);
    if (statement.startsWith('INSERT OR IGNORE INTO word_study_history')) {
      const key = String(params[0]);
      if (this.history.has(key)) return { changes: 0 };
      this.history.set(key, {
        term_key: key,
        first_studied_at: String(params[3]),
        first_correct_at: (params[4] as string | null) ?? null,
        rewarded_at: null,
      });
      return { changes: 1 };
    }
    if (statement.startsWith('UPDATE word_study_history SET first_correct_at')) {
      const entry = this.history.get(String(params[1]));
      if (entry && !entry.first_correct_at) entry.first_correct_at = String(params[0]);
      return { changes: entry ? 1 : 0 };
    }
    if (statement.startsWith('UPDATE word_study_history SET rewarded_at')) {
      const entry = this.history.get(String(params[1]));
      if (entry) entry.rewarded_at = String(params[0]);
      return { changes: entry ? 1 : 0 };
    }
    if (!statement.startsWith('INSERT')) return { changes: 0 };

    let row: Row;
    if (statement.includes("VALUES (?, 'reward'")) {
      row = {
        id: String(params[0]),
        kind: 'reward',
        word_id: String(params[1]),
        term_key: String(params[2]),
        source_id: String(params[3]),
        amount: Number(params[4]),
        balance_after: Number(params[5]),
        reason: String(params[6]),
        created_at: String(params[7]),
        cycle_id: params[8] === undefined ? 'initial' : String(params[8]),
      };
    } else if (statement.includes("VALUES (?, 'penalty'")) {
      row = {
        id: String(params[0]),
        kind: 'penalty',
        word_id: String(params[1]),
        term_key: String(params[2]),
        source_id: String(params[3]),
        amount: Number(params[4]),
        balance_after: Number(params[5]),
        reason: String(params[6]),
        created_at: String(params[7]),
      };
    } else if (statement.includes("VALUES (?, 'reset'")) {
      row = {
        id: String(params[0]),
        kind: 'reset',
        word_id: null,
        term_key: null,
        source_id: null,
        amount: Number(params[1]),
        balance_after: 0,
        reason: String(params[2]),
        created_at: String(params[3]),
      };
    } else {
      return { changes: 0 };
    }

    if (row.kind === 'reward') {
      const sameCycle =
        (existing: Row) => (existing.cycle_id ?? 'initial') === (row.cycle_id ?? 'initial');
      const duplicate = this.rows.some(
        (existing) =>
          existing.kind === 'reward' &&
          sameCycle(existing) &&
          ((existing.term_key && existing.term_key === row.term_key) ||
            (existing.word_id && existing.word_id === row.word_id) ||
            (existing.source_id && existing.source_id === row.source_id)),
      );
      if (duplicate) return { changes: 0 };
    }
    if (row.source_id && this.rows.some((existing) => existing.source_id === row.source_id)) {
      return { changes: 0 };
    }

    this.rows.push(row);
    return { changes: 1 };
  }
}

function db(fake: FakeDb): SQLiteDatabase {
  return fake as unknown as SQLiteDatabase;
}

describe('stable reward identity', () => {
  it('normalises case and spacing and keeps tracks apart', () => {
    expect(wordTermKey({ term: '  Take   Into Account ', track: 'general' })).toBe(
      'take into account|general',
    );
    expect(wordTermKey({ term: 'criminal', track: 'ielts' })).toBe('criminal|ielts');
  });

  it('finds a reward by term even when the word row id changed', async () => {
    const fake = new FakeDb();
    const sqlite = db(fake);
    const first = await rewardWordInTransaction(
      sqlite,
      { id: 'w1', term: 'criminal', track: 'general', level: 3 },
      0,
      'answer-1',
      new Date('2026-01-01T00:00:00Z'),
    );
    expect(first).toEqual({ amount: 500, alreadyRewarded: false });

    // Delete and re-add: a new row id, same term. It must not pay again.
    const second = await rewardWordInTransaction(
      sqlite,
      { id: 'w2', term: 'Criminal', track: 'general', level: 3 },
      0,
      'answer-2',
      new Date('2026-01-02T00:00:00Z'),
    );
    expect(second).toEqual({ amount: 0, alreadyRewarded: true });
    expect(await hasRewardForTerm(sqlite, { id: 'w2', term: 'criminal', track: 'general' })).toBe(
      true,
    );
    expect(await getCoinBalance(sqlite)).toBe(500);
  });

  it('pays once in a new study cycle and blocks the second answer of that cycle', async () => {
    const fake = new FakeDb();
    const sqlite = db(fake);
    const word = { id: 'w1', term: 'criminal', track: 'general' as const, level: 3 as const };
    expect(
      (await rewardWordInTransaction(sqlite, word, 0, 'cycle-1-answer', undefined, 'cycle-1'))
        .amount,
    ).toBe(500);
    const resetCycle = await getWordStudyState(sqlite, word, 'cycle-2');
    expect(resetCycle.rewarded).toBe(false);
    expect(isFirstRewardEligible(resetCycle)).toBe(true);
    expect(
      (await rewardWordInTransaction(sqlite, word, 0, 'cycle-2-answer', undefined, 'cycle-2'))
        .amount,
    ).toBe(500);
    expect(
      (await rewardWordInTransaction(sqlite, word, 0, 'cycle-2-second', undefined, 'cycle-2'))
        .alreadyRewarded,
    ).toBe(true);
    expect(await getCoinBalance(sqlite)).toBe(1_000);
  });

  it('allows the same spelling in the other track', async () => {
    const fake = new FakeDb();
    const sqlite = db(fake);
    await rewardWordInTransaction(
      sqlite,
      { id: 'g1', term: 'criminal', track: 'general', level: 3 },
      0,
      'g-answer',
    );
    const ielts = await rewardWordInTransaction(
      sqlite,
      { id: 'i1', term: 'criminal', track: 'ielts', level: 3 },
      0,
      'i-answer',
    );
    expect(ielts).toEqual({ amount: 500, alreadyRewarded: false });
    expect(await getCoinBalance(sqlite)).toBe(1_000);
  });
});

describe('permanent study history', () => {
  it('remembers a term even when the word row is deleted and re-added', async () => {
    const fake = new FakeDb();
    const sqlite = db(fake);
    const first = await ensureWordStudied(
      sqlite,
      { id: 'w1', term: 'take into account', track: 'general' },
      false,
    );
    expect(first).toBe(false);
    // The word row is deleted here; only the history remains.
    const again = await ensureWordStudied(
      sqlite,
      { id: 'w2', term: 'Take Into Account', track: 'general' },
      true,
    );
    expect(again).toBe(true);
    expect(fake.history.get('take into account|general')?.first_correct_at).not.toBeNull();
  });

  it('still pays a term whose first attempt was wrong, then correct', async () => {
    const fake = new FakeDb();
    const sqlite = db(fake);
    const word = { id: 'w1', term: 'criminal', track: 'general' as const, level: 3 as const };

    // First encounter: the learner guessed wrong. Nothing is paid, but the
    // term is now in the permanent history without a correct answer.
    await ensureWordStudied(sqlite, word, false);
    const afterWrong = await getWordStudyState(sqlite, word);
    expect(afterWrong).toEqual({ studied: true, firstCorrectAt: null, rewarded: false });
    expect(isFirstRewardEligible(afterWrong)).toBe(true);

    // First correct answer later: this is the first valid completion, so it
    // earns exactly once.
    await ensureWordStudied(sqlite, word, true);
    const paid = await rewardWordInTransaction(sqlite, word, 0, 'first-correct');
    expect(paid).toEqual({ amount: 500, alreadyRewarded: false });

    const afterReward = await getWordStudyState(sqlite, word);
    expect(afterReward.firstCorrectAt).not.toBeNull();
    expect(afterReward.rewarded).toBe(true);
    expect(isFirstRewardEligible(afterReward)).toBe(false);

    // A later correct answer in review never pays again.
    expect(await rewardWordInTransaction(sqlite, word, 0, 'review-correct')).toEqual({
      amount: 0,
      alreadyRewarded: true,
    });
    expect(await getCoinBalance(sqlite)).toBe(500);
  });

  it('treats a reset wallet as already rewarded for the same term', async () => {
    const fake = new FakeDb();
    const sqlite = db(fake);
    const word = { id: 'w1', term: 'civil', track: 'general' as const, level: 3 as const };
    await ensureWordStudied(sqlite, word, true);
    await rewardWordInTransaction(sqlite, word, 0, 'only-answer');
    await resetCoins(sqlite);
    const state = await getWordStudyState(sqlite, word);
    expect(state.rewarded).toBe(true);
    expect(isFirstRewardEligible(state)).toBe(false);
  });
});

describe('repeat mistakes and idempotency', () => {
  it('penalises a word that was studied before, exactly once per answer', async () => {
    const fake = new FakeDb();
    const sqlite = db(fake);
    const word = { id: 'w1', term: 'criminal', track: 'general' as const, level: 3 as const };
    await rewardWordInTransaction(sqlite, word, 0, 'first-answer');
    expect(await getCoinBalance(sqlite)).toBe(500);

    const penalty = await penalizeWordInTransaction(sqlite, word, 'review-answer');
    expect(penalty).toEqual({ amount: -500, duplicate: false });
    expect(await getCoinBalance(sqlite)).toBe(0);

    const repeated = await penalizeWordInTransaction(sqlite, word, 'review-answer');
    expect(repeated).toEqual({ amount: 0, duplicate: true });
    expect(await getCoinBalance(sqlite)).toBe(0);
  });

  it('never lets the balance go below zero', async () => {
    const fake = new FakeDb();
    const sqlite = db(fake);
    const word = { id: 'w1', term: 'harvest', track: 'general' as const, level: 5 as const };
    await rewardWordInTransaction(sqlite, word, 0, 'first');
    // Reset leaves the reward marker in place but empties the wallet.
    await resetCoins(sqlite);
    expect(await getCoinBalance(sqlite)).toBe(0);
    expect(await penalizeWordInTransaction(sqlite, word, 'review')).toEqual({
      amount: 0,
      duplicate: false,
    });
    // Reset is not a way to earn the same word again.
    expect(await rewardWordInTransaction(sqlite, word, 0, 'again')).toEqual({
      amount: 0,
      alreadyRewarded: true,
    });
  });
});

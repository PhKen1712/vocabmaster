import type { SQLiteDatabase } from 'expo-sqlite';

import { dateKey } from '../lib/date';
import { newId } from '../lib/ids';
import type { CoinEvent, Level } from '../types';
import { bonusStreakDays } from '../streak/streak';
import { applyPenalty, coinMultiplier, coinReward, nextCoinMilestone } from './values';

/**
 * Append-only coin ledger. The balance is always the sum of the signed
 * amounts, so duplicate taps and retries cannot double-pay: every reward is
 * guarded by a unique index on the word, and every write happens in the same
 * transaction as the review that caused it.
 */

interface LedgerRow {
  id: string;
  kind: string;
  word_id: string | null;
  amount: number;
  balance_after: number;
  reason: string | null;
  created_at: string;
}

function asKind(value: string): CoinEvent['kind'] {
  return value === 'penalty' || value === 'reset' ? value : 'reward';
}

function rowToEvent(row: LedgerRow): CoinEvent {
  return {
    id: row.id,
    kind: asKind(row.kind),
    wordId: row.word_id,
    amount: row.amount,
    balanceAfter: row.balance_after,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

async function readBalance(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ balance: number }>(
    'SELECT COALESCE(SUM(amount), 0) AS balance FROM coin_ledger;',
  );
  return Math.max(0, Math.round(row?.balance ?? 0));
}

export async function getCoinBalance(db: SQLiteDatabase): Promise<number> {
  return readBalance(db);
}

/**
 * Days that count toward the multiplier: consecutive goal-met days ending
 * today (or yesterday, while today is still open), stopping at the latest
 * repaired day. Pure data comes from the caller so tests stay deterministic.
 */
export async function getValidStreakDays(
  db: SQLiteDatabase,
  today = dateKey(),
): Promise<number> {
  const goals = await db.getAllAsync<{ date: string }>(
    'SELECT date FROM daily_activity WHERE goal_met = 1 ORDER BY date ASC;',
  );
  const restores = await db.getAllAsync<{ date: string }>(
    'SELECT date FROM streak_restores ORDER BY date ASC;',
  );
  const lastRestore = restores.length > 0 ? (restores[restores.length - 1]?.date ?? null) : null;
  return bonusStreakDays(
    goals.map((row) => row.date),
    today,
    lastRestore,
  );
}

export interface CoinSummary {
  balance: number;
  validStreakDays: number;
  multiplier: number;
  nextMilestone: ReturnType<typeof nextCoinMilestone>;
}

export async function getCoinSummary(
  db: SQLiteDatabase,
  today = dateKey(),
): Promise<CoinSummary> {
  const [balance, validStreakDays] = await Promise.all([
    readBalance(db),
    getValidStreakDays(db, today),
  ]);
  return {
    balance,
    validStreakDays,
    multiplier: coinMultiplier(validStreakDays),
    nextMilestone: nextCoinMilestone(validStreakDays),
  };
}

export async function listCoinHistory(
  db: SQLiteDatabase,
  limit = 30,
): Promise<CoinEvent[]> {
  const rows = await db.getAllAsync<LedgerRow>(
    `SELECT * FROM coin_ledger WHERE amount <> 0
     ORDER BY created_at DESC, rowid DESC LIMIT ?;`,
    [limit],
  );
  return rows.map(rowToEvent);
}

/**
 * Award a word once. Must be called inside the review transaction so the
 * reward and the grade commit together. Returns the coins added (0 when the
 * word was already rewarded or the word has no reward value).
 */
export async function rewardWordInTransaction(
  db: SQLiteDatabase,
  word: { id: string; level: Level },
  validStreakDays: number,
  now = new Date(),
): Promise<number> {
  const existing = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM coin_ledger WHERE kind = 'reward' AND word_id = ? LIMIT 1;",
    [word.id],
  );
  if (existing) return 0;

  const base = coinReward(word.level, validStreakDays);
  if (base <= 0) return 0;

  const balance = await readBalance(db);
  const result = await db.runAsync(
    `INSERT OR IGNORE INTO coin_ledger
      (id, kind, word_id, amount, balance_after, reason, created_at)
     VALUES (?, 'reward', ?, ?, ?, ?, ?);`,
    [newId(), word.id, base, balance + base, 'Học từ mới', now.toISOString()],
  );
  return result.changes > 0 ? base : 0;
}

/**
 * Subtract a word's base value after a wrong review. No-op for words that were
 * never rewarded (so a technical slip cannot drain a new learner's balance).
 */
export async function penalizeWordInTransaction(
  db: SQLiteDatabase,
  word: { id: string; level: Level },
  now = new Date(),
): Promise<number> {
  const rewarded = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM coin_ledger WHERE kind = 'reward' AND word_id = ? LIMIT 1;",
    [word.id],
  );
  if (!rewarded) return 0;

  const balance = await readBalance(db);
  const change = applyPenalty(balance, word.level);
  if (change >= 0) return 0;

  await db.runAsync(
    `INSERT INTO coin_ledger
      (id, kind, word_id, amount, balance_after, reason, created_at)
     VALUES (?, 'penalty', ?, ?, ?, ?, ?);`,
    [newId(), word.id, change, balance + change, 'Ôn sai', now.toISOString()],
  );
  return change;
}

/** Wallet reset: records the event, keeps every other kind of study data. */
export async function resetCoins(db: SQLiteDatabase, now = new Date()): Promise<number> {
  const balance = await readBalance(db);
  await db.runAsync(
    `INSERT INTO coin_ledger
      (id, kind, word_id, amount, balance_after, reason, created_at)
     VALUES (?, 'reset', NULL, ?, 0, ?, ?);`,
    [newId(), -balance, 'Reset tiền xu', now.toISOString()],
  );
  return balance;
}

export async function clearCoinLedger(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('DELETE FROM coin_ledger;');
}

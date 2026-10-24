import type { SQLiteDatabase } from 'expo-sqlite';

import { dateKey } from '../lib/date';
import { newId } from '../lib/ids';
import { normalizeTerm } from '../lib/text';
import type { CoinEvent, Level, Track } from '../types';
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

/** Stable identity of a learned item, independent of its current row id. */
export function wordTermKey(word: { term: string; track: Track }): string {
  return `${normalizeTerm(word.term)}|${word.track}`;
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

export interface WordStudyState {
  /** True when the term appears in the permanent history at all. */
  studied: boolean;
  /** ISO time of the first correct answer, or null while never correct. */
  firstCorrectAt: string | null;
  /** True when a reward row already exists for this term. */
  rewarded: boolean;
}

/**
 * The single rule for paying a word: no reward row yet, and the term has never
 * been answered correctly before. A wrong first attempt does not use up the
 * reward; a correct one does, forever.
 */
export function isFirstRewardEligible(state: WordStudyState): boolean {
  return !state.rewarded && state.firstCorrectAt === null;
}

/** Read the permanent per-term history without changing it. */
export async function getWordStudyState(
  db: SQLiteDatabase,
  word: { id: string; term: string; track: Track },
): Promise<WordStudyState> {
  const termKey = wordTermKey(word);
  const row = await db.getFirstAsync<{ first_correct_at: string | null }>(
    'SELECT first_correct_at FROM word_study_history WHERE term_key = ?;',
    [termKey],
  );
  const reward = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM coin_ledger WHERE kind = 'reward' AND (term_key = ? OR word_id = ?) LIMIT 1;",
    [termKey, word.id],
  );
  return {
    studied: Boolean(row),
    firstCorrectAt: row?.first_correct_at ?? null,
    rewarded: Boolean(reward),
  };
}

/**
 * Remember that this term has been studied, independently of the words row.
 * Returns true when the term was already studied before this answer, which is
 * what makes delete-and-re-add ineligible for another reward.
 */
export async function ensureWordStudied(
  db: SQLiteDatabase,
  word: { id: string; term: string; track: Track },
  correct: boolean,
  now = new Date(),
): Promise<boolean> {
  const termKey = wordTermKey(word);
  const existing = await db.getFirstAsync<{ first_correct_at: string | null }>(
    'SELECT first_correct_at FROM word_study_history WHERE term_key = ?;',
    [termKey],
  );
  if (existing) {
    if (correct && !existing.first_correct_at) {
      await db.runAsync(
        'UPDATE word_study_history SET first_correct_at = ? WHERE term_key = ? AND first_correct_at IS NULL;',
        [now.toISOString(), termKey],
      );
    }
    return true;
  }

  await db.runAsync(
    `INSERT OR IGNORE INTO word_study_history
      (term_key, term, track, first_studied_at, first_correct_at)
     VALUES (?, ?, ?, ?, ?);`,
    [
      termKey,
      word.term,
      word.track,
      now.toISOString(),
      correct ? now.toISOString() : null,
    ],
  );
  return false;
}

/** True when this exact term already has a reward row (from any past row id). */
export async function hasRewardForTerm(
  db: SQLiteDatabase,
  word: { id: string; term: string; track: Track },
): Promise<boolean> {
  const row = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM coin_ledger WHERE kind = 'reward' AND (term_key = ? OR word_id = ?) LIMIT 1;",
    [wordTermKey(word), word.id],
  );
  return Boolean(row);
}

export interface RewardOutcome {
  /** Coins actually added; 0 when this word already paid or is not eligible. */
  amount: number;
  /** True when an earlier reward for this same term still exists. */
  alreadyRewarded: boolean;
}

export interface PenaltyOutcome {
  /** Signed change; 0 when nothing moved. */
  amount: number;
  /** True when the exact answer event was already processed. */
  duplicate: boolean;
}

async function sourceAlreadyProcessed(
  db: SQLiteDatabase,
  sourceId: string,
): Promise<CoinEvent | null> {
  const row = await db.getFirstAsync<LedgerRow>(
    'SELECT * FROM coin_ledger WHERE source_id = ? LIMIT 1;',
    [sourceId],
  );
  return row ? rowToEvent(row) : null;
}

/**
 * Award a word once, for the first successful study of its *term*, not of its
 * current database row. Deleting a word and adding it again therefore cannot
 * pay twice, and resetting coins does not delete the reward marker either.
 *
 * Must be called inside the review transaction so the reward and the grade
 * commit together. A word that was already studied before this answer never
 * becomes eligible retroactively.
 */
export async function rewardWordInTransaction(
  db: SQLiteDatabase,
  word: { id: string; term: string; track: Track; level: Level },
  validStreakDays: number,
  sourceId: string,
  now = new Date(),
): Promise<RewardOutcome> {
  const termKey = wordTermKey(word);
  const existing = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM coin_ledger WHERE kind = 'reward' AND (term_key = ? OR word_id = ?) LIMIT 1;",
    [termKey, word.id],
  );
  if (existing) return { amount: 0, alreadyRewarded: true };

  const processed = await sourceAlreadyProcessed(db, sourceId);
  if (processed) return { amount: 0, alreadyRewarded: true };

  const base = coinReward(word.level, validStreakDays);
  if (base <= 0) return { amount: 0, alreadyRewarded: false };

  const balance = await readBalance(db);
  const result = await db.runAsync(
    `INSERT OR IGNORE INTO coin_ledger
      (id, kind, word_id, term_key, source_id, amount, balance_after, reason, created_at)
     VALUES (?, 'reward', ?, ?, ?, ?, ?, ?, ?);`,
    [
      newId(),
      word.id,
      termKey,
      sourceId,
      base,
      balance + base,
      'Học từ mới lần đầu',
      now.toISOString(),
    ],
  );
  if (result.changes > 0) {
    await db.runAsync(
      'UPDATE word_study_history SET rewarded_at = ? WHERE term_key = ?;',
      [now.toISOString(), termKey],
    );
    return { amount: base, alreadyRewarded: false };
  }
  return { amount: 0, alreadyRewarded: true };
}

/**
 * Subtract a word's base value after a wrong answer on a word that had already
 * been studied at least once. A newly introduced word can be answered wrong
 * without a penalty, and a technical failure/skip never reaches this function.
 */
export async function penalizeWordInTransaction(
  db: SQLiteDatabase,
  word: { id: string; term: string; track: Track; level: Level },
  sourceId: string,
  now = new Date(),
): Promise<PenaltyOutcome> {
  const processed = await sourceAlreadyProcessed(db, sourceId);
  if (processed) return { amount: 0, duplicate: true };

  const balance = await readBalance(db);
  const change = applyPenalty(balance, word.level);
  if (change >= 0) return { amount: 0, duplicate: false };

  await db.runAsync(
    `INSERT INTO coin_ledger
      (id, kind, word_id, term_key, source_id, amount, balance_after, reason, created_at)
     VALUES (?, 'penalty', ?, ?, ?, ?, ?, ?, ?);`,
    [
      newId(),
      word.id,
      wordTermKey(word),
      sourceId,
      change,
      balance + change,
      'Trả lời sai khi ôn lại',
      now.toISOString(),
    ],
  );
  return { amount: change, duplicate: false };
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

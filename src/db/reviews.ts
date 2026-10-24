import type { SQLiteDatabase } from 'expo-sqlite';

import {
  ensureWordStudied,
  getCoinBalance,
  getValidStreakDays,
  getWordStudyState,
  isFirstRewardEligible,
  penalizeWordInTransaction,
  rewardWordInTransaction,
} from '../coins/ledger';
import { dateKey } from '../lib/date';
import { newId, nowIso } from '../lib/ids';
import { isGoalMet } from '../streak/streak';
import type { ScheduleResult } from '../srs/fsrs';
import type { QuizKind, ReviewLog, ReviewRating, Word } from '../types';
import { rowToReview, type ReviewRow } from './schema';

export interface RecordReviewInput {
  word: Word;
  rating: ReviewRating;
  correct: boolean;
  mode: QuizKind | 'manual';
  durationMs: number;
  schedule: ScheduleResult;
  dailyGoal: number;
  /**
   * Stable id for this answer. A repeated tap or a retried write uses the same
   * id, so the review and the coin movement can never be applied twice.
   */
  eventId?: string;
  /** Injected for deterministic tests. */
  now?: Date;
}

export interface RecordReviewResult {
  log: ReviewLog;
  word: Word;
  goalMet: boolean;
  /** Signed coins change for this answer (0 when nothing moved). */
  coinChange: number;
  coinBalance: number;
  /** Plain-language reason, shown even when the change is 0. */
  coinReason: string | null;
  /** True when this exact answer event had already been saved. */
  duplicate: boolean;
}

/**
 * One transaction: review log + word SRS state + daily counters. If any step
 * fails, nothing is written, so statistics can never disagree with the word's
 * due date.
 */
export async function recordReview(
  db: SQLiteDatabase,
  input: RecordReviewInput,
): Promise<RecordReviewResult> {
  const now = input.now ?? new Date();
  const timestamp = now.toISOString();
  const eventId = input.eventId?.trim() || newId();

  // Idempotency at the data layer: the same answer can be submitted again after
  // a double tap or a retry without creating a second review or coin movement.
  const previous = await db.getFirstAsync<ReviewRow>('SELECT * FROM reviews WHERE id = ?;', [
    eventId,
  ]);
  if (previous) {
    return {
      log: rowToReview(previous),
      word: input.word,
      goalMet: false,
      coinChange: 0,
      coinBalance: await getCoinBalance(db),
      coinReason: 'Câu trả lời này đã được ghi nhận trước đó.',
      duplicate: true,
    };
  }

  const log: ReviewLog = {
    id: eventId,
    wordId: input.word.id,
    rating: input.rating,
    correct: input.correct,
    mode: input.mode,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    reviewedAt: timestamp,
    previousIntervalDays: 0,
    nextIntervalDays: input.schedule.intervalDays,
  };

  const wasNew = input.word.reps === 0;
  const day = dateKey(now);
  // Read the multiplier before today's activity is updated: the answer that
  // completes a milestone day still earns at the old step, matching the rule
  // that old rewards are never recalculated.
  const validDays = await getValidStreakDays(db, day);
  let goalMet = false;
  let coinChange = 0;
  let coinReason: string | null = null;

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO reviews
        (id, word_id, rating, correct, mode, duration_ms, reviewed_at,
         previous_interval_days, next_interval_days)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        log.id,
        log.wordId,
        log.rating,
        log.correct ? 1 : 0,
        log.mode,
        log.durationMs,
        log.reviewedAt,
        log.previousIntervalDays,
        log.nextIntervalDays,
      ],
    );

    await db.runAsync(
      `UPDATE words SET
        learning_state = ?, due_at = ?, stability = ?, difficulty = ?,
        reps = ?, lapses = ?, last_reviewed_at = ?, updated_at = ?
       WHERE id = ?;`,
      [
        input.schedule.learningState,
        input.schedule.dueAt,
        input.schedule.stability,
        input.schedule.difficulty,
        input.schedule.reps,
        input.schedule.lapses,
        input.schedule.lastReviewedAt,
        timestamp,
        input.word.id,
      ],
    );

    const activity = await db.getFirstAsync<{
      new_words: number;
      reviews: number;
      answered: number;
      correct: number;
    }>('SELECT new_words, reviews, answered, correct FROM daily_activity WHERE date = ?;', [
      day,
    ]);

    const newWords = (activity?.new_words ?? 0) + (wasNew ? 1 : 0);
    const reviews = (activity?.reviews ?? 0) + (wasNew ? 0 : 1);
    const answered = (activity?.answered ?? 0) + 1;
    const correct = (activity?.correct ?? 0) + (input.correct ? 1 : 0);
    goalMet = isGoalMet(newWords, reviews, input.dailyGoal);

    await db.runAsync(
      `INSERT INTO daily_activity (date, new_words, reviews, answered, correct, goal_met, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET
         new_words = excluded.new_words,
         reviews = excluded.reviews,
         answered = excluded.answered,
         correct = excluded.correct,
         goal_met = excluded.goal_met,
         updated_at = excluded.updated_at;`,
      [day, newWords, reviews, answered, correct, goalMet ? 1 : 0, timestamp],
    );

    // A permanent per-term history answers "was this item studied before?"
    // even if the word row was deleted and created again. Read it before the
    // update: the first *correct* answer is the only one that can pay, so a
    // word first seen wrong can still earn on its first valid completion.
    const priorState = await getWordStudyState(db, input.word);
    const studiedBefore = await ensureWordStudied(db, input.word, input.correct, now);

    // Coins move inside the same transaction as the grade: a crash can never
    // leave a paid word without its review, or the other way round. Speaking
    // practice is intentionally excluded from both rewards and penalties.
    if (input.mode === 'speaking') {
      coinReason = 'Luyện nói không tính xu.';
    } else if (input.correct) {
      // Eligibility is "never completed correctly before", not "this row is
      // new". A learner who saw the word once and answered wrong can still
      // earn on the first correct answer; one reward per term, forever.
      const firstValidCompletion = isFirstRewardEligible(priorState);
      if (!firstValidCompletion) {
        coinReason = priorState.rewarded
          ? '0 xu — từ này đã nhận thưởng ở lần học đầu tiên.'
          : '0 xu — từ đã học trước đó nên không cộng thưởng lần nữa.';
      } else {
        const outcome = await rewardWordInTransaction(
          db,
          input.word,
          validDays,
          log.id,
          now,
        );
        coinChange = outcome.amount;
        coinReason = outcome.alreadyRewarded
          ? '0 xu — từ này đã nhận thưởng trước đó.'
          : outcome.amount > 0
            ? `+${outcome.amount.toLocaleString('vi-VN')} xu — hoàn thành từ mới lần đầu.`
            : '0 xu — từ này chưa có mức thưởng.';
      }
    } else if (wasNew && !studiedBefore) {
      coinReason = 'Từ mới: trả lời sai chưa bị trừ xu.';
    } else {
      const outcome = await penalizeWordInTransaction(db, input.word, log.id, now);
      coinChange = outcome.amount;
      coinReason = outcome.duplicate
        ? 'Câu trả lời này đã được xử lý trước đó.'
        : outcome.amount < 0
          ? `${outcome.amount.toLocaleString('vi-VN')} xu — trả lời sai khi ôn lại.`
          : '0 xu — số dư đã bằng 0 nên không trừ thêm.';
    }
  });

  const updatedWord: Word = {
    ...input.word,
    learningState: input.schedule.learningState,
    dueAt: input.schedule.dueAt,
    stability: input.schedule.stability,
    difficulty: input.schedule.difficulty,
    reps: input.schedule.reps,
    lapses: input.schedule.lapses,
    lastReviewedAt: input.schedule.lastReviewedAt,
    updatedAt: timestamp,
  };

  return {
    log,
    word: updatedWord,
    goalMet,
    coinChange,
    coinBalance: await getCoinBalance(db),
    coinReason,
    duplicate: false,
  };
}

export async function getWordHistory(
  db: SQLiteDatabase,
  wordId: string,
  limit = 30,
): Promise<ReviewLog[]> {
  const rows = await db.getAllAsync<ReviewRow>(
    'SELECT * FROM reviews WHERE word_id = ? ORDER BY reviewed_at DESC LIMIT ?;',
    [wordId, limit],
  );
  return rows.map(rowToReview);
}

export async function getRecentReviews(
  db: SQLiteDatabase,
  limit = 50,
): Promise<ReviewLog[]> {
  const rows = await db.getAllAsync<ReviewRow>(
    'SELECT * FROM reviews ORDER BY reviewed_at DESC LIMIT ?;',
    [limit],
  );
  return rows.map(rowToReview);
}

export async function getReviewCount(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM reviews;');
  return row?.count ?? 0;
}

/** Accuracy per local day for the last N days (only days with answers). */
export async function getAccuracyByDay(
  db: SQLiteDatabase,
  days = 7,
): Promise<{ date: string; answered: number; correct: number; goalMet: boolean }[]> {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db.getAllAsync<{
    date: string;
    answered: number;
    correct: number;
    goal_met: number;
  }>(
    `SELECT date, answered, correct, goal_met FROM daily_activity
     WHERE date >= ? ORDER BY date ASC;`,
    [dateKey(since)],
  );
  return rows.map((row) => ({
    date: row.date,
    answered: row.answered,
    correct: row.correct,
    goalMet: row.goal_met === 1,
  }));
}

export async function deleteAllReviews(db: SQLiteDatabase): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.execAsync('DELETE FROM reviews;');
    await db.execAsync('DELETE FROM daily_activity;');
    // execAsync nhận đúng 1 tham số; câu lệnh có bind param phải dùng runAsync.
    await db.runAsync(
      `UPDATE words SET learning_state = 'new', due_at = NULL, stability = 0,
        difficulty = 0, reps = 0, lapses = 0, last_reviewed_at = NULL, updated_at = ?;`,
      nowIso(),
    );
  });
}

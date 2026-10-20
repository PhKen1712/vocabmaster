import type { SQLiteDatabase } from 'expo-sqlite';

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
  /** Injected for deterministic tests. */
  now?: Date;
}

export interface RecordReviewResult {
  log: ReviewLog;
  word: Word;
  goalMet: boolean;
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
  const log: ReviewLog = {
    id: newId(),
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
  let goalMet = false;

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

  return { log, word: updatedWord, goalMet };
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

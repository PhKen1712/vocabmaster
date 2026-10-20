import type { SQLiteDatabase } from 'expo-sqlite';

import { dateKey, lastNDays } from '../lib/date';
import { computeStreak, type StreakSummary } from '../streak/streak';
import type { DailyActivity, DailyStats, Settings, Track } from '../types';
import { rowToActivity, type ActivityRow } from './schema';
import { getCounts } from './words';

export async function getActivity(
  db: SQLiteDatabase,
  days = 30,
): Promise<DailyActivity[]> {
  const since = lastNDays(days)[0] ?? dateKey();
  const rows = await db.getAllAsync<ActivityRow>(
    'SELECT * FROM daily_activity WHERE date >= ? ORDER BY date ASC;',
    [since],
  );
  return rows.map(rowToActivity);
}

export async function getAllActivity(db: SQLiteDatabase): Promise<DailyActivity[]> {
  const rows = await db.getAllAsync<ActivityRow>(
    'SELECT * FROM daily_activity ORDER BY date ASC;',
  );
  return rows.map(rowToActivity);
}

export async function getActivityForDate(
  db: SQLiteDatabase,
  day: string,
): Promise<DailyActivity> {
  const row = await db.getFirstAsync<ActivityRow>(
    'SELECT * FROM daily_activity WHERE date = ?;',
    [day],
  );
  return row
    ? rowToActivity(row)
    : { date: day, newWords: 0, reviews: 0, answered: 0, correct: 0, goalMet: false };
}

export async function getStreak(db: SQLiteDatabase, today = dateKey()): Promise<StreakSummary> {
  const rows = await db.getAllAsync<{ date: string }>(
    'SELECT date FROM daily_activity WHERE goal_met = 1 ORDER BY date ASC;',
  );
  return computeStreak(
    rows.map((row) => row.date),
    today,
  );
}

/** Accuracy over the last `days` days, 0 when there is no data. */
export async function getAccuracy(
  db: SQLiteDatabase,
  days = 7,
): Promise<{ answered: number; correct: number; ratio: number }> {
  const since = lastNDays(days)[0] ?? dateKey();
  const row = await db.getFirstAsync<{ answered: number; correct: number }>(
    `SELECT SUM(answered) AS answered, SUM(correct) AS correct
     FROM daily_activity WHERE date >= ?;`,
    [since],
  );
  const answered = row?.answered ?? 0;
  const correct = row?.correct ?? 0;
  return { answered, correct, ratio: answered > 0 ? correct / answered : 0 };
}

export async function getDailyStats(
  db: SQLiteDatabase,
  track: Track,
  settings: Settings,
): Promise<DailyStats> {
  const today = dateKey();
  const [counts, streak, activity, accuracy] = await Promise.all([
    getCounts(db, track),
    getStreak(db, today),
    getActivityForDate(db, today),
    getAccuracy(db, 7),
  ]);

  const history = await db.getAllAsync<{ date: string }>(
    'SELECT date FROM daily_activity WHERE answered > 0 ORDER BY date DESC LIMIT 120;',
  );

  return {
    dueCount: counts.due,
    newCount: counts.fresh,
    learnedCount: counts.review + counts.learning + counts.known,
    totalCount: counts.total,
    streak: streak.current,
    bestStreak: streak.best,
    todayNewWords: activity.newWords,
    todayReviews: activity.reviews,
    todayAnswered: activity.answered,
    todayCorrect: activity.correct,
    accuracy7d: accuracy.ratio,
    activeDays: history.map((row) => row.date),
    goalMetToday: activity.newWords + activity.reviews >= Math.max(1, settings.dailyGoal),
  };
}

export interface TrackProgress {
  track: Track;
  total: number;
  learned: number;
  due: number;
  accuracy30d: number;
  activeDays30d: number;
}

export async function getTrackProgress(
  db: SQLiteDatabase,
  track: Track,
): Promise<TrackProgress> {
  const counts = await getCounts(db, track);
  const since = lastNDays(30)[0] ?? dateKey();
  const row = await db.getFirstAsync<{ answered: number; correct: number; days: number }>(
    `SELECT SUM(answered) AS answered, SUM(correct) AS correct, COUNT(*) AS days
     FROM daily_activity WHERE date >= ? AND answered > 0;`,
    [since],
  );
  const answered = row?.answered ?? 0;
  return {
    track,
    total: counts.total,
    learned: counts.review + counts.learning + counts.known,
    due: counts.due,
    accuracy30d: answered > 0 ? (row?.correct ?? 0) / answered : 0,
    activeDays30d: row?.days ?? 0,
  };
}

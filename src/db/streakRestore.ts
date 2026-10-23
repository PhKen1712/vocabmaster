import type { SQLiteDatabase } from 'expo-sqlite';

import { dateKey } from '../lib/date';
import { nowIso } from '../lib/ids';
import { streakRestoreOffer, type StreakRestoreOffer } from '../streak/streak';

/**
 * Streak repair, stored separately from daily_activity:
 *
 * - the repaired date counts as a completed day for the visible streak;
 * - it never counts toward the coin multiplier;
 * - `lost_from` is unique, so the same broken run can only be repaired once,
 *   no matter how often the app is closed or reopened.
 */

export interface RestoreState {
  offer: StreakRestoreOffer | null;
  restoredDates: string[];
}

export async function getRestoreState(
  db: SQLiteDatabase,
  dailyGoal: number,
  today = dateKey(),
): Promise<RestoreState> {
  const [goals, restores, activity] = await Promise.all([
    db.getAllAsync<{ date: string }>(
      'SELECT date FROM daily_activity WHERE goal_met = 1 ORDER BY date ASC;',
    ),
    db.getAllAsync<{ date: string; lost_from: string }>(
      'SELECT date, lost_from FROM streak_restores ORDER BY date ASC;',
    ),
    db.getFirstAsync<{ new_words: number }>(
      'SELECT new_words FROM daily_activity WHERE date = ?;',
      [today],
    ),
  ]);

  const offer = streakRestoreOffer({
    goalDates: goals.map((row) => row.date),
    todayKey: today,
    dailyGoal,
    todayNewWords: activity?.new_words ?? 0,
    restoredFrom: restores.map((row) => row.lost_from),
  });

  return { offer, restoredDates: restores.map((row) => row.date) };
}

/**
 * Record a successful repair. Progress is re-read inside the call so two taps
 * on a stale screen cannot both win, and the unique anchor index backs that up.
 */
export async function completeStreakRestore(
  db: SQLiteDatabase,
  offer: StreakRestoreOffer,
  today = dateKey(),
): Promise<boolean> {
  const activity = await db.getFirstAsync<{ new_words: number }>(
    'SELECT new_words FROM daily_activity WHERE date = ?;',
    [today],
  );
  if ((activity?.new_words ?? 0) < offer.targetNewWords) return false;

  const result = await db.runAsync(
    `INSERT OR IGNORE INTO streak_restores (date, lost_from, lost_days, target_new_words, restored_at)
     VALUES (?, ?, ?, ?, ?);`,
    [today, offer.lastGoalDate, offer.lostDays, offer.targetNewWords, nowIso()],
  );
  return result.changes > 0;
}

export async function clearStreakRestores(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('DELETE FROM streak_restores;');
}

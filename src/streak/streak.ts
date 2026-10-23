import { addDays, dateKey, parseDateKey } from '../lib/date';

export interface StreakSummary {
  current: number;
  best: number;
  /** Last day on which the goal was completed, or null. */
  lastGoalDate: string | null;
  studiedToday: boolean;
}

/**
 * Streak rules (deliberate, documented):
 * - Only days whose goal was actually completed count. Opening the app or
 *   answering one question does not extend a streak.
 * - Today is still "in progress": if the goal has not been met yet but
 *   yesterday was completed, the streak stays alive until midnight. This
 *   avoids the streak appearing broken all morning.
 * - Dates are local calendar keys (YYYY-MM-DD) supplied by the caller, so
 *   timezone handling lives in one place.
 */
export function computeStreak(goalDates: readonly string[], todayKey: string): StreakSummary {
  const dates = new Set(goalDates.filter((key) => /^\d{4}-\d{2}-\d{2}$/.test(key)));
  const sorted = [...dates].sort();

  let best = 0;
  let run = 0;
  let previous: string | null = null;
  for (const key of sorted) {
    if (previous) {
      const expected = dateKey(addDays(parseDateKey(previous), 1));
      run = expected === key ? run + 1 : 1;
    } else {
      run = 1;
    }
    best = Math.max(best, run);
    previous = key;
  }

  const studiedToday = dates.has(todayKey);
  const yesterdayKey = dateKey(addDays(parseDateKey(todayKey), -1));

  let cursor = studiedToday ? todayKey : yesterdayKey;
  if (!dates.has(cursor)) {
    return { current: 0, best, lastGoalDate: sorted[sorted.length - 1] ?? null, studiedToday };
  }

  let current = 0;
  while (dates.has(cursor)) {
    current += 1;
    cursor = dateKey(addDays(parseDateKey(cursor), -1));
    if (current > 10_000) break; // defensive guard against malformed data
  }

  return {
    current,
    best: Math.max(best, current),
    lastGoalDate: sorted[sorted.length - 1] ?? null,
    studiedToday,
  };
}

/**
 * Consecutive completed days behind the coin multiplier.
 *
 * Today still counts when it is already done; otherwise the run may end
 * yesterday, exactly like the visible streak. Days on or before the last
 * repaired day are excluded, so repairing a streak resets the multiplier to
 * 1.0 and it has to be earned again.
 */
export function bonusStreakDays(
  goalDates: readonly string[],
  todayKey: string,
  lastRestoreDate: string | null = null,
): number {
  const dates = new Set(goalDates.filter((key) => /^\d{4}-\d{2}-\d{2}$/.test(key)));
  const yesterdayKey = dateKey(addDays(parseDateKey(todayKey), -1));
  let cursor = dates.has(todayKey) ? todayKey : yesterdayKey;
  let days = 0;

  while (dates.has(cursor) && (!lastRestoreDate || cursor > lastRestoreDate)) {
    days += 1;
    cursor = dateKey(addDays(parseDateKey(cursor), -1));
    if (days > 10_000) break;
  }
  return days;
}

export interface StreakRestoreOffer {
  /** Number of completed days before the missed day. */
  lostDays: number;
  /** Last day the goal was completed, i.e. the anchor of the lost run. */
  lastGoalDate: string;
  /** The gap day that broke the chain (yesterday). */
  missedDate: string;
  /** New words that must be learned today: twice the daily target. */
  targetNewWords: number;
  progressNewWords: number;
  ready: boolean;
}

/**
 * One-day streak repair.
 *
 * A repair is offered only when the learner missed exactly yesterday, still
 * had a completed run right before it, and has not repaired that same run
 * before. The target is twice the daily new-word goal and only new words count
 * — reviews can never buy a streak back.
 */
export function streakRestoreOffer(input: {
  goalDates: readonly string[];
  todayKey: string;
  dailyGoal: number;
  todayNewWords: number;
  /** Anchors (`lost_from`) of repairs that already happened. */
  restoredFrom?: readonly string[];
}): StreakRestoreOffer | null {
  const dates = new Set(input.goalDates.filter((key) => /^\d{4}-\d{2}-\d{2}$/.test(key)));
  const today = parseDateKey(input.todayKey);
  const missedDate = dateKey(addDays(today, -1));
  const lastGoalDate = dateKey(addDays(today, -2));

  // Yesterday already completed (or repaired) means the chain never broke.
  if (dates.has(missedDate)) return null;
  // A longer gap cannot be repaired with one day's effort.
  if (!dates.has(lastGoalDate)) return null;
  if (input.restoredFrom?.includes(lastGoalDate)) return null;

  let lostDays = 0;
  let cursor = lastGoalDate;
  while (dates.has(cursor)) {
    lostDays += 1;
    cursor = dateKey(addDays(parseDateKey(cursor), -1));
    if (lostDays > 10_000) break;
  }

  const targetNewWords = Math.max(1, Math.round(input.dailyGoal)) * 2;
  const progressNewWords = Math.max(0, Math.round(input.todayNewWords));
  return {
    lostDays,
    lastGoalDate,
    missedDate,
    targetNewWords,
    progressNewWords,
    ready: progressNewWords >= targetNewWords,
  };
}

/** Whether the daily target is met, counting new words plus reviews. */
export function isGoalMet(newWords: number, reviews: number, dailyGoal: number): boolean {
  const goal = Math.max(1, Math.round(dailyGoal));
  return newWords + reviews >= goal;
}

export function goalProgress(
  newWords: number,
  reviews: number,
  dailyGoal: number,
): { completed: number; goal: number; ratio: number; met: boolean } {
  const goal = Math.max(1, Math.round(dailyGoal));
  const completed = Math.max(0, newWords) + Math.max(0, reviews);
  return {
    completed,
    goal,
    ratio: Math.min(1, completed / goal),
    met: completed >= goal,
  };
}

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

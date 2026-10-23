import type { Level } from '../types';

/**
 * Coin rules (virtual currency, no real-world value):
 *
 * - A new word pays its level's base value once, the first time the learner
 *   answers it correctly in a graded session.
 * - Reviewing a word that was already paid never pays again.
 * - A wrong answer on an already-rewarded word subtracts the word's base value,
 *   never below zero.
 * - Every ten consecutive completed days raise the multiplier by 0.1. Days
 *   repaired with a streak restore do not count, and a repair resets the run.
 */

export const COIN_BASE_BY_LEVEL: Record<Level, number> = {
  0: 100,
  1: 250,
  2: 250,
  3: 500,
  4: 750,
  5: 1_000,
  6: 1_000,
};

export const COIN_MILESTONE_DAYS = 10;

/** `1 + 0.1 * floor(validDays / 10)`, rounded to one decimal. */
export function coinMultiplier(validStreakDays: number): number {
  const days = Math.max(0, Math.floor(validStreakDays));
  return Math.round((1 + 0.1 * Math.floor(days / COIN_MILESTONE_DAYS)) * 10) / 10;
}

/** Coin paid for learning a brand-new word at the current multiplier. */
export function coinReward(level: Level, validStreakDays: number): number {
  return Math.floor(COIN_BASE_BY_LEVEL[level] * coinMultiplier(validStreakDays));
}

/** Base value used when a review answer is wrong. */
export function coinPenalty(level: Level): number {
  return COIN_BASE_BY_LEVEL[level];
}

/** Apply a penalty without ever letting the balance go below zero. */
export function applyPenalty(balance: number, level: Level): number {
  const safeBalance = Math.max(0, Math.floor(balance));
  const applied = Math.min(safeBalance, coinPenalty(level));
  return applied === 0 ? 0 : -applied;
}

export interface NextMilestone {
  /** Valid streak days needed for the next multiplier step. */
  days: number;
  /** Days still missing; equal to `days` when the run is empty. */
  remaining: number;
  multiplier: number;
}

export function nextCoinMilestone(validStreakDays: number): NextMilestone {
  const days = Math.max(0, Math.floor(validStreakDays));
  const steps = Math.floor(days / COIN_MILESTONE_DAYS);
  const nextDays = (steps + 1) * COIN_MILESTONE_DAYS;
  return {
    days: nextDays,
    remaining: Math.max(0, nextDays - days),
    multiplier: coinMultiplier(nextDays),
  };
}

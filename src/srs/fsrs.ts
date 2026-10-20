import type { LearningState, ReviewRating } from '../types';
import { MS_PER_DAY } from '../lib/date';

/**
 * Spaced repetition scheduler.
 *
 * The maths follow the FSRS-5 model (Free Spaced Repetition Scheduler) with its
 * published default weights. Two deliberate adaptations for a vocabulary app:
 *
 * 1. The very first answer uses short learning steps (10 minutes / 1 day / 1 day
 *    / 2 days) instead of FSRS's multi-day initial stability, because a brand
 *    new word should be seen again quickly.
 * 2. Reviews that happen within the same day use the FSRS short-term stability
 *    formula, so a learner who repeats a word in one session does not get a
 *    month-long interval.
 *
 * Nothing here touches the network or the database, which keeps the scheduler
 * unit-testable and deterministic (a `now` value is always injected).
 */

/** Published FSRS-5 default weights (19 parameters). */
export const DEFAULT_WEIGHTS: readonly number[] = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192,
  1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621,
];

const DECAY = -0.5;
/** 0.9^(1/DECAY) - 1, so that a stability of S returns an interval of S days at 90% retention. */
const FACTOR = 19 / 81;
const MIN_STABILITY = 0.1;
const MAX_INTERVAL_DAYS = 3650; // 10 years, a safety clamp
const MIN_DIFFICULTY = 1;
const MAX_DIFFICULTY = 10;

export interface CardState {
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  lastReviewedAt: string | null;
  dueAt: string | null;
  learningState: LearningState;
}

export interface ScheduleResult {
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  learningState: LearningState;
  intervalDays: number;
  dueAt: string;
  lastReviewedAt: string;
  /** Days between the previous review and this one (0 for a new card). */
  elapsedDays: number;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function initialStability(rating: ReviewRating, weights = DEFAULT_WEIGHTS): number {
  const w = weights[rating - 1] ?? 0.4;
  return Math.max(MIN_STABILITY, w);
}

export function initialDifficulty(rating: ReviewRating, weights = DEFAULT_WEIGHTS): number {
  const w4 = weights[4] ?? 7.19;
  const w5 = weights[5] ?? 0.53;
  return clamp(w4 - Math.exp(w5 * (rating - 1)) + 1, MIN_DIFFICULTY, MAX_DIFFICULTY);
}

/** Probability that the learner still remembers the card after `elapsedDays`. */
export function retrievability(
  elapsedDays: number,
  stability: number,
): number {
  const safeStability = Math.max(MIN_STABILITY, stability);
  const safeElapsed = Math.max(0, elapsedDays);
  return Math.pow(1 + FACTOR * (safeElapsed / safeStability), DECAY);
}

/** Interval (days) that lands on the requested retention probability. */
export function intervalForRetention(stability: number, retention: number): number {
  const desired = clamp(retention, 0.7, 0.97);
  const raw = (Math.max(MIN_STABILITY, stability) / FACTOR) * (Math.pow(desired, 1 / DECAY) - 1);
  return clamp(Math.round(raw), 1, MAX_INTERVAL_DAYS);
}

export function nextDifficulty(
  difficulty: number,
  rating: ReviewRating,
  weights = DEFAULT_WEIGHTS,
): number {
  const w6 = weights[6] ?? 1.46;
  const w7 = weights[7] ?? 0.0046;
  const next = difficulty - w6 * (rating - 3);
  const meanReversion = w7 * initialDifficulty(4, weights) + (1 - w7) * next;
  return clamp(meanReversion, MIN_DIFFICULTY, MAX_DIFFICULTY);
}

export function stabilityAfterRecall(
  difficulty: number,
  stability: number,
  recallProbability: number,
  rating: ReviewRating,
  weights = DEFAULT_WEIGHTS,
): number {
  const w8 = weights[8] ?? 1.545;
  const w9 = weights[9] ?? 0.119;
  const w10 = weights[10] ?? 1.019;
  const w15 = weights[15] ?? 0.2315;
  const w16 = weights[16] ?? 2.9898;

  const hardPenalty = rating === 2 ? w15 : 1;
  const easyBonus = rating === 4 ? w16 : 1;
  const safeStability = Math.max(MIN_STABILITY, stability);
  const growth =
    1 +
    Math.exp(w8) *
      (11 - difficulty) *
      Math.pow(safeStability, -w9) *
      (Math.exp(w10 * (1 - recallProbability)) - 1) *
      hardPenalty *
      easyBonus;

  return Math.max(MIN_STABILITY, safeStability * Math.max(1, growth));
}

export function stabilityAfterForget(
  difficulty: number,
  stability: number,
  recallProbability: number,
  weights = DEFAULT_WEIGHTS,
): number {
  const w11 = weights[11] ?? 1.9395;
  const w12 = weights[12] ?? 0.11;
  const w13 = weights[13] ?? 0.296;
  const w14 = weights[14] ?? 2.2698;
  const safeStability = Math.max(MIN_STABILITY, stability);
  const forgetStability =
    w11 *
    Math.pow(difficulty, -w12) *
    (Math.pow(safeStability + 1, w13) - 1) *
    Math.exp(w14 * (1 - recallProbability));
  // A lapse must never increase the interval.
  return clamp(forgetStability, MIN_STABILITY, safeStability);
}

/** FSRS short-term stability update for a review on the same day. */
export function shortTermStability(
  stability: number,
  rating: ReviewRating,
  weights = DEFAULT_WEIGHTS,
): number {
  const w17 = weights[17] ?? 0.51655;
  const w18 = weights[18] ?? 0.6621;
  const next = Math.max(MIN_STABILITY, stability) * Math.exp(w17 * (rating - 3 + w18));
  return clamp(next, MIN_STABILITY, MAX_INTERVAL_DAYS);
}

function dueDateFrom(now: Date, intervalDays: number): string {
  const ms = intervalDays < 1 ? 10 * 60 * 1000 : intervalDays * MS_PER_DAY;
  return new Date(now.getTime() + ms).toISOString();
}

function elapsedDaysBetween(now: Date, lastReviewedAt: string | null): number {
  if (!lastReviewedAt) return 0;
  const last = new Date(lastReviewedAt).getTime();
  if (Number.isNaN(last)) return 0;
  return Math.max(0, (now.getTime() - last) / MS_PER_DAY);
}

/**
 * Compute the next scheduling state for a card.
 *
 * @param card     current scheduling state
 * @param rating   1 Again, 2 Hard, 3 Good, 4 Easy
 * @param now      injected clock (deterministic tests)
 * @param retention desired retention used to turn stability into an interval
 */
export function schedule(
  card: CardState,
  rating: ReviewRating,
  now: Date = new Date(),
  retention = 0.9,
  weights = DEFAULT_WEIGHTS,
): ScheduleResult {
  const isNew = card.reps === 0 || card.stability <= 0;
  const elapsedDays = elapsedDaysBetween(now, card.lastReviewedAt);

  if (isNew) {
    const stability = initialStability(rating, weights);
    const difficulty = initialDifficulty(rating, weights);
    // Gentle learning steps for the first exposure.
    const firstInterval = rating === 1 ? 0 : rating === 2 ? 1 : rating === 3 ? 1 : 2;
    return {
      stability,
      difficulty,
      reps: 1,
      lapses: rating === 1 ? 1 : card.lapses,
      learningState: rating === 1 ? 'learning' : 'review',
      intervalDays: firstInterval,
      dueAt: dueDateFrom(now, firstInterval),
      lastReviewedAt: now.toISOString(),
      elapsedDays: 0,
    };
  }

  const difficulty = nextDifficulty(card.difficulty, rating, weights);
  const recallProbability = retrievability(elapsedDays, card.stability);

  let stability: number;
  let lapses = card.lapses;
  let learningState: LearningState;

  if (elapsedDays < 1) {
    stability = shortTermStability(card.stability, rating, weights);
    if (rating === 1) lapses += 1;
    learningState = rating === 1 ? 'relearning' : 'learning';
  } else if (rating === 1) {
    stability = stabilityAfterForget(card.difficulty, card.stability, recallProbability, weights);
    lapses += 1;
    learningState = 'relearning';
  } else {
    stability = stabilityAfterRecall(
      card.difficulty,
      card.stability,
      recallProbability,
      rating,
      weights,
    );
    learningState = 'review';
  }

  const intervalDays =
    rating === 1 ? 0 : intervalForRetention(stability, retention);

  return {
    stability,
    difficulty,
    reps: card.reps + 1,
    lapses,
    learningState,
    intervalDays,
    dueAt: dueDateFrom(now, intervalDays),
    lastReviewedAt: now.toISOString(),
    elapsedDays,
  };
}

/** Suggested default rating after a graded answer. */
export function defaultRatingFor(correct: boolean): ReviewRating {
  return correct ? 3 : 1;
}

/** Human-readable interval, used in the session feedback panel. */
export function describeInterval(intervalDays: number): string {
  if (intervalDays <= 0) return '10 phút';
  if (intervalDays === 1) return '1 ngày';
  if (intervalDays < 30) return `${intervalDays} ngày`;
  if (intervalDays < 365) {
    const months = Math.round(intervalDays / 30);
    return `${months} tháng`;
  }
  const years = (intervalDays / 365).toFixed(1);
  return `${years} năm`;
}

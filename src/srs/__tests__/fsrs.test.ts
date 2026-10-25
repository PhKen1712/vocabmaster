import {
  DEFAULT_WEIGHTS,
  initialDifficulty,
  intervalForRetention,
  retrievability,
  schedule,
  type CardState,
} from '../fsrs';

const newCard: CardState = {
  stability: 0,
  difficulty: 0,
  reps: 0,
  lapses: 0,
  lastReviewedAt: null,
  dueAt: null,
  learningState: 'new',
};

const NOW = new Date('2026-10-19T08:00:00.000Z');

describe('FSRS scheduler', () => {
  it('has the documented 19 default weights', () => {
    expect(DEFAULT_WEIGHTS).toHaveLength(19);
  });

  it('orders initial difficulty: again > hard > good > easy', () => {
    const again = initialDifficulty(1);
    const hard = initialDifficulty(2);
    const good = initialDifficulty(3);
    const easy = initialDifficulty(4);
    expect(again).toBeGreaterThan(hard);
    expect(hard).toBeGreaterThan(good);
    expect(good).toBeGreaterThan(easy);
    expect(easy).toBeGreaterThanOrEqual(1);
    expect(again).toBeLessThanOrEqual(10);
  });

  it('returns an interval equal to stability at 90% retention', () => {
    expect(intervalForRetention(10, 0.9)).toBe(10);
    // A lower desired retention allows a longer interval; a higher one is shorter.
    expect(intervalForRetention(10, 0.8)).toBeGreaterThan(10);
    expect(intervalForRetention(10, 0.97)).toBeLessThan(10);
    expect(intervalForRetention(10, 0.97)).toBeGreaterThanOrEqual(1);
  });

  it('decreases retrievability as time passes', () => {
    const day1 = retrievability(1, 10);
    const day10 = retrievability(10, 10);
    const day30 = retrievability(30, 10);
    expect(day1).toBeGreaterThan(day10);
    expect(day10).toBeGreaterThan(day30);
    expect(day1).toBeLessThanOrEqual(1);
    expect(day30).toBeGreaterThanOrEqual(0);
  });

  it('schedules a brand new word with short learning steps', () => {
    const again = schedule(newCard, 1, NOW);
    const good = schedule(newCard, 3, NOW);
    const easy = schedule(newCard, 4, NOW);

    expect(again.intervalDays).toBe(0);
    expect(again.learningState).toBe('learning');
    expect(new Date(again.dueAt).getTime()).toBeGreaterThan(NOW.getTime());
    expect(good.intervalDays).toBe(1);
    expect(good.learningState).toBe('review');
    expect(easy.intervalDays).toBe(2);
    expect(good.reps).toBe(1);
    expect(good.lapses).toBe(0);
    expect(again.lapses).toBe(1);
  });

  it('grows the interval across successful reviews', () => {
    const first = schedule(newCard, 3, NOW);
    const afterDelay = new Date(NOW.getTime() + first.intervalDays * 86_400_000);
    const card: CardState = {
      stability: first.stability,
      difficulty: first.difficulty,
      reps: first.reps,
      lapses: first.lapses,
      lastReviewedAt: first.lastReviewedAt,
      dueAt: first.dueAt,
      learningState: first.learningState,
    };

    const second = schedule(card, 3, afterDelay);
    expect(second.stability).toBeGreaterThan(first.stability);
    expect(second.intervalDays).toBeGreaterThanOrEqual(first.intervalDays);

    const later = new Date(afterDelay.getTime() + second.intervalDays * 86_400_000);
    const third = schedule(
      {
        stability: second.stability,
        difficulty: second.difficulty,
        reps: second.reps,
        lapses: second.lapses,
        lastReviewedAt: second.lastReviewedAt,
        dueAt: second.dueAt,
        learningState: second.learningState,
      },
      3,
      later,
    );
    expect(third.intervalDays).toBeGreaterThanOrEqual(second.intervalDays);
    expect(third.difficulty).toBeGreaterThanOrEqual(1);
    expect(third.difficulty).toBeLessThanOrEqual(10);
  });

  it('never increases stability on a lapse', () => {
    const card: CardState = {
      stability: 30,
      difficulty: 5,
      reps: 4,
      lapses: 1,
      lastReviewedAt: new Date(NOW.getTime() - 30 * 86_400_000).toISOString(),
      dueAt: NOW.toISOString(),
      learningState: 'review',
    };
    const lapsed = schedule(card, 1, NOW);
    expect(lapsed.stability).toBeLessThanOrEqual(card.stability);
    expect(lapsed.intervalDays).toBe(0);
    expect(lapsed.learningState).toBe('relearning');
    expect(lapsed.lapses).toBe(2);
  });

  it('uses the short-term formula for same-day repeats', () => {
    const card: CardState = {
      stability: 4,
      difficulty: 5,
      reps: 2,
      lapses: 0,
      lastReviewedAt: new Date(NOW.getTime() - 60_000).toISOString(),
      dueAt: NOW.toISOString(),
      learningState: 'learning',
    };
    const good = schedule(card, 3, NOW);
    const again = schedule(card, 1, NOW);
    expect(good.stability).toBeGreaterThan(card.stability);
    expect(again.stability).toBeLessThanOrEqual(card.stability);
    expect(good.intervalDays).toBeGreaterThanOrEqual(1);
  });

  it('uses the learner-configured minutes for the next due date', () => {
    const intervals = { again: 5, hard: 30, good: 12 * 60, easy: 24 * 60 };
    const good = schedule(newCard, 3, NOW, 0.9, undefined, intervals);
    expect(good.intervalDays).toBeCloseTo(0.5, 6);
    expect(new Date(good.dueAt).getTime()).toBe(NOW.getTime() + 12 * 60 * 60_000);

    const card: CardState = {
      stability: good.stability,
      difficulty: good.difficulty,
      reps: good.reps,
      lapses: good.lapses,
      lastReviewedAt: good.lastReviewedAt,
      dueAt: good.dueAt,
      learningState: good.learningState,
    };
    const again = schedule(card, 1, NOW, 0.9, undefined, intervals);
    expect(new Date(again.dueAt).getTime()).toBe(NOW.getTime() + 5 * 60_000);
    expect(again.learningState).toBe('relearning');
  });

  it('is deterministic for a fixed clock', () => {
    const a = schedule(newCard, 3, NOW);
    const b = schedule(newCard, 3, NOW);
    expect(a).toEqual(b);
  });

  it('clamps out-of-range desired retention', () => {
    const card: CardState = {
      stability: 20,
      difficulty: 5,
      reps: 3,
      lapses: 0,
      lastReviewedAt: new Date(NOW.getTime() - 20 * 86_400_000).toISOString(),
      dueAt: NOW.toISOString(),
      learningState: 'review',
    };
    const low = schedule(card, 3, NOW, 0.1); // clamped up to 0.70 → longer interval
    const high = schedule(card, 3, NOW, 0.99); // clamped down to 0.97 → shorter interval
    expect(low.intervalDays).toBeGreaterThanOrEqual(1);
    expect(high.intervalDays).toBeGreaterThanOrEqual(1);
    expect(high.intervalDays).toBeLessThan(low.intervalDays);
  });
});

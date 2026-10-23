import {
  COIN_BASE_BY_LEVEL,
  applyPenalty,
  coinMultiplier,
  coinPenalty,
  coinReward,
  nextCoinMilestone,
} from '../values';

describe('coin base values', () => {
  it('pays the documented value per level', () => {
    expect(COIN_BASE_BY_LEVEL).toEqual({
      0: 100,
      1: 250,
      2: 250,
      3: 500,
      4: 750,
      5: 1_000,
      6: 1_000,
    });
    expect(coinReward(0, 0)).toBe(100);
    expect(coinReward(3, 0)).toBe(500);
    expect(coinReward(6, 0)).toBe(1_000);
  });
});

describe('streak multiplier', () => {
  it('steps up every ten valid days', () => {
    expect(coinMultiplier(0)).toBe(1);
    expect(coinMultiplier(9)).toBe(1);
    expect(coinMultiplier(10)).toBeCloseTo(1.1);
    expect(coinMultiplier(19)).toBeCloseTo(1.1);
    expect(coinMultiplier(20)).toBeCloseTo(1.2);
    expect(coinMultiplier(30)).toBeCloseTo(1.3);
  });

  it('applies the multiplier only to new rewards', () => {
    expect(coinReward(3, 0)).toBe(500);
    expect(coinReward(3, 10)).toBe(550);
    expect(coinReward(3, 20)).toBe(600);
  });

  it('explains the next milestone for the UI', () => {
    expect(nextCoinMilestone(0)).toMatchObject({ days: 10, remaining: 10 });
    expect(nextCoinMilestone(9)).toMatchObject({ days: 10, remaining: 1 });
    expect(nextCoinMilestone(10)).toMatchObject({ days: 20, remaining: 10 });
  });
});

describe('review penalties', () => {
  it('subtracts the base value, not the multiplied reward', () => {
    expect(coinPenalty(3)).toBe(500);
    expect(applyPenalty(2_000, 3)).toBe(-500);
  });

  it('never lets the balance go below zero', () => {
    expect(applyPenalty(200, 3)).toBe(-200);
    expect(applyPenalty(0, 3)).toBe(0);
    expect(applyPenalty(-50, 1)).toBe(0);
  });
});

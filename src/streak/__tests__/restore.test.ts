import { bonusStreakDays, streakRestoreOffer } from '../streak';

describe('bonusStreakDays', () => {
  it('counts the run that ends today or yesterday', () => {
    expect(bonusStreakDays(['2026-10-17', '2026-10-18', '2026-10-19'], '2026-10-19')).toBe(3);
    expect(bonusStreakDays(['2026-10-17', '2026-10-18'], '2026-10-19')).toBe(2);
  });

  it('counts nothing when the last completed day is older than yesterday', () => {
    expect(bonusStreakDays(['2026-10-16', '2026-10-17'], '2026-10-19')).toBe(0);
  });

  it('resets after a repaired day, even when that day was completed', () => {
    const days = ['2026-10-17', '2026-10-18', '2026-10-19'];
    expect(bonusStreakDays(days, '2026-10-19', '2026-10-19')).toBe(0);
    expect(bonusStreakDays(days, '2026-10-19', '2026-10-18')).toBe(1);
  });
});

describe('streakRestoreOffer', () => {
  const base = {
    todayKey: '2026-10-19',
    dailyGoal: 10,
    todayNewWords: 0,
  };

  it('offers a repair after missing exactly one day', () => {
    const offer = streakRestoreOffer({
      ...base,
      goalDates: ['2026-10-15', '2026-10-16', '2026-10-17'],
    });
    expect(offer).toMatchObject({
      lostDays: 3,
      lastGoalDate: '2026-10-17',
      missedDate: '2026-10-18',
      targetNewWords: 20,
      ready: false,
    });
  });

  it('requires twice the daily goal in new words', () => {
    const goalDates = ['2026-10-17'];
    expect(
      streakRestoreOffer({ ...base, goalDates, todayNewWords: 19 })?.ready,
    ).toBe(false);
    expect(
      streakRestoreOffer({ ...base, goalDates, todayNewWords: 20 })?.ready,
    ).toBe(true);
  });

  it('does not offer anything while yesterday is still completed', () => {
    expect(
      streakRestoreOffer({
        ...base,
        goalDates: ['2026-10-17', '2026-10-18'],
      }),
    ).toBeNull();
  });

  it('does not offer a repair for a longer gap', () => {
    // Nothing completed on 17 or 18: the chain is more than one day old.
    expect(
      streakRestoreOffer({ ...base, goalDates: ['2026-10-15', '2026-10-16'] }),
    ).toBeNull();
  });

  it('cannot repair the same lost run twice', () => {
    expect(
      streakRestoreOffer({
        ...base,
        goalDates: ['2026-10-17'],
        restoredFrom: ['2026-10-17'],
      }),
    ).toBeNull();
  });

  it('uses a fresh goal each day', () => {
    const offer = streakRestoreOffer({
      ...base,
      dailyGoal: 15,
      goalDates: ['2026-10-17'],
    });
    expect(offer?.targetNewWords).toBe(30);
  });
});

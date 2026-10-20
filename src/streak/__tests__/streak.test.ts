import { computeStreak, goalProgress, isGoalMet } from '../streak';

describe('streak', () => {
  it('counts consecutive completed days ending today', () => {
    const summary = computeStreak(['2026-10-17', '2026-10-18', '2026-10-19'], '2026-10-19');
    expect(summary.current).toBe(3);
    expect(summary.best).toBe(3);
    expect(summary.studiedToday).toBe(true);
  });

  it('keeps the streak alive before today is completed', () => {
    const summary = computeStreak(['2026-10-17', '2026-10-18'], '2026-10-19');
    expect(summary.current).toBe(2);
    expect(summary.studiedToday).toBe(false);
  });

  it('breaks the streak after a full missed day', () => {
    const summary = computeStreak(['2026-10-16', '2026-10-17'], '2026-10-19');
    expect(summary.current).toBe(0);
    expect(summary.best).toBe(2);
  });

  it('returns zero with no history and does not invent a day', () => {
    const summary = computeStreak([], '2026-10-19');
    expect(summary.current).toBe(0);
    expect(summary.best).toBe(0);
    expect(summary.lastGoalDate).toBeNull();
  });

  it('tracks the best streak across separated runs', () => {
    const summary = computeStreak(
      [
        '2026-09-01',
        '2026-09-02',
        '2026-09-03',
        '2026-09-04',
        '2026-10-18',
        '2026-10-19',
      ],
      '2026-10-19',
    );
    expect(summary.current).toBe(2);
    expect(summary.best).toBe(4);
  });

  it('ignores malformed dates and duplicates', () => {
    const summary = computeStreak(
      ['2026-10-18', '2026-10-18', 'not-a-date', '2026-13-40'],
      '2026-10-19',
    );
    expect(summary.current).toBe(1);
  });

  it('counts new words plus reviews toward the goal', () => {
    expect(isGoalMet(4, 6, 10)).toBe(true);
    expect(isGoalMet(3, 3, 10)).toBe(false);
    expect(isGoalMet(0, 1, 1)).toBe(true);
    expect(isGoalMet(0, 0, 0)).toBe(false);
  });

  it('reports bounded progress for the UI', () => {
    expect(goalProgress(2, 3, 10)).toMatchObject({ completed: 5, goal: 10, met: false });
    expect(goalProgress(9, 9, 10)).toMatchObject({ ratio: 1, met: true });
  });
});

import {
  albumCoverageHours,
  ALBUM_INTERVAL_PRESETS,
  combineAlbumInterval,
  describeAlbumIntervalRisk,
  formatAlbumInterval,
  MAX_ALBUM_INTERVAL_MINUTES,
  splitAlbumInterval,
  validateAlbumInterval,
} from '../interval';

describe('validateAlbumInterval', () => {
  it('accepts any combination of hours and minutes, not just preset values', () => {
    expect(validateAlbumInterval('0', '7')).toEqual({ ok: true, minutes: 7 });
    expect(validateAlbumInterval('0', '25')).toEqual({ ok: true, minutes: 25 });
    expect(validateAlbumInterval('1', '30')).toEqual({ ok: true, minutes: 90 });
    expect(validateAlbumInterval('2', '30')).toEqual({ ok: true, minutes: 150 });
  });

  it('treats a blank field as zero', () => {
    expect(validateAlbumInterval('', '45')).toEqual({ ok: true, minutes: 45 });
    expect(validateAlbumInterval('3', '')).toEqual({ ok: true, minutes: 180 });
  });

  it('refuses zero instead of silently substituting another value', () => {
    const result = validateAlbumInterval('0', '0');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('lớn hơn 0');
  });

  it('refuses negative and non-numeric input with a readable reason', () => {
    const negative = validateAlbumInterval('-1', '30');
    expect(negative.ok).toBe(false);
    if (!negative.ok) expect(negative.error).toContain('âm');

    const text = validateAlbumInterval('hai', '30');
    expect(text.ok).toBe(false);
    if (!text.ok) expect(text.error).toContain('số nguyên');
  });

  it('caps the cycle at one week', () => {
    expect(validateAlbumInterval('168', '0')).toEqual({ ok: true, minutes: 10080 });
    const tooLong = validateAlbumInterval('169', '0');
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.error).toContain('7 ngày');
    expect(MAX_ALBUM_INTERVAL_MINUTES).toBe(10080);
  });
});

describe('interval helpers', () => {
  it('round-trips split and combine', () => {
    for (const minutes of [1, 7, 25, 59, 60, 90, 150, 1440]) {
      const parts = splitAlbumInterval(minutes);
      expect(combineAlbumInterval(parts.hours, parts.minutes)).toBe(minutes);
    }
  });

  it('formats the way a learner would say it', () => {
    expect(formatAlbumInterval(45)).toBe('45 phút');
    expect(formatAlbumInterval(120)).toBe('2 giờ');
    expect(formatAlbumInterval(150)).toBe('2 giờ 30 phút');
    expect(formatAlbumInterval(0)).toBe('0 phút');
  });

  it('keeps the quick presets distinct so a chip never lies about its value', () => {
    const labels = ALBUM_INTERVAL_PRESETS.map((minutes) => formatAlbumInterval(minutes));
    expect(new Set(labels).size).toBe(ALBUM_INTERVAL_PRESETS.length);
  });

  it('reports how long a 48-slot queue lasts at the chosen cycle', () => {
    expect(albumCoverageHours(10, 48)).toBe(8);
    expect(albumCoverageHours(60, 48)).toBe(48);
  });

  it('warns about a cycle iOS cannot keep up with, and stays quiet otherwise', () => {
    const short = describeAlbumIntervalRisk(7, 48);
    expect(short).toContain('48');
    expect(short).toContain('nền');

    // 20 minutes × 48 slots is about 16 hours, so the note states that figure.
    const medium = describeAlbumIntervalRisk(20, 48);
    expect(medium).toContain('16 giờ');

    // 30 minutes × 48 slots covers a full day, so there is nothing to warn about.
    expect(describeAlbumIntervalRisk(30, 48)).toBeNull();
    expect(describeAlbumIntervalRisk(60, 48)).toBeNull();
  });
});

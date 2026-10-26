/**
 * The album notification cycle is decided by the learner, not by a fixed menu.
 *
 * The learner types a number of hours and/or minutes (7 minutes, 25 minutes,
 * 90 minutes, 2 hours 30 minutes …). Minutes is the smallest unit the app can
 * honour and hours the largest one it needs, so every value is stored as a
 * single integer count of minutes.
 *
 * This module is deliberately free of React and native imports so both the
 * scheduler and the Settings/Album screens use exactly the same rules, and so
 * the rules can be unit tested.
 */

/** Below one minute there is no cycle, only a loop. */
export const MIN_ALBUM_INTERVAL_MINUTES = 1;

/** Seven days: long enough for a weekly cadence, short enough to stay sane. */
export const MAX_ALBUM_INTERVAL_MINUTES = 7 * 24 * 60;

/** Shortcuts offered next to the free inputs. Never a restriction. */
export const ALBUM_INTERVAL_PRESETS = [10, 15, 30, 60, 120, 240] as const;

export interface IntervalParts {
  hours: number;
  minutes: number;
}

export function splitAlbumInterval(totalMinutes: number): IntervalParts {
  const safe = Math.max(0, Math.round(totalMinutes));
  return { hours: Math.floor(safe / 60), minutes: safe % 60 };
}

export function combineAlbumInterval(hours: number, minutes: number): number {
  const safeHours = Number.isFinite(hours) ? Math.max(0, Math.trunc(hours)) : 0;
  const safeMinutes = Number.isFinite(minutes) ? Math.max(0, Math.trunc(minutes)) : 0;
  return safeHours * 60 + safeMinutes;
}

/** "45 phút", "2 giờ", "2 giờ 30 phút". */
export function formatAlbumInterval(totalMinutes: number): string {
  const { hours, minutes } = splitAlbumInterval(totalMinutes);
  const pieces: string[] = [];
  if (hours > 0) pieces.push(`${hours} giờ`);
  if (minutes > 0) pieces.push(`${minutes} phút`);
  return pieces.length > 0 ? pieces.join(' ') : '0 phút';
}

export type IntervalValidation =
  | { ok: true; minutes: number }
  | { ok: false; error: string };

function asWholeNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number.parseInt(trimmed, 10);
  return Number.isFinite(value) ? value : null;
}

/**
 * Validate what the learner typed. The value is never silently rewritten: an
 * invalid entry returns the reason instead, so the screen can show it and keep
 * the text the learner is still editing.
 */
export function validateAlbumInterval(
  hoursText: string,
  minutesText: string,
): IntervalValidation {
  if (/-/.test(hoursText) || /-/.test(minutesText)) {
    return { ok: false, error: 'Không nhận giá trị âm.' };
  }
  const hours = asWholeNumber(hoursText);
  const minutes = asWholeNumber(minutesText);
  if (hours === null || minutes === null) {
    return { ok: false, error: 'Chỉ nhập số nguyên (ví dụ 2 giờ 30 phút).' };
  }

  const total = combineAlbumInterval(hours, minutes);
  if (total <= 0) {
    return { ok: false, error: 'Chu kỳ phải lớn hơn 0 phút.' };
  }
  if (total > MAX_ALBUM_INTERVAL_MINUTES) {
    return {
      ok: false,
      error: `Tối đa ${MAX_ALBUM_INTERVAL_MINUTES / (24 * 60)} ngày.`,
    };
  }
  return { ok: true, minutes: total };
}

/** How many hours the pre-scheduled queue covers from the next slot. */
export function albumCoverageHours(totalMinutes: number, queueSize: number): number {
  const perSlot = Math.max(MIN_ALBUM_INTERVAL_MINUTES, Math.round(totalMinutes));
  return (perSlot * Math.max(0, Math.floor(queueSize))) / 60;
}

/**
 * An honest note about what iOS can actually deliver at this cycle. Returns null
 * when a full day is covered, so the normal case stays quiet.
 */
export function describeAlbumIntervalRisk(
  totalMinutes: number,
  queueSize: number,
): string | null {
  const coverage = albumCoverageHours(totalMinutes, queueSize);
  const rounded = coverage >= 10 ? Math.round(coverage) : Math.round(coverage * 10) / 10;
  if (totalMinutes < 15) {
    return `Chu kỳ dưới 15 phút rất ngắn: iOS không cho app tự chạy nền, nên app chỉ lên trước ${queueSize} thông báo (khoảng ${rounded} giờ) và bổ sung khi bạn mở app.`;
  }
  if (coverage < 24) {
    return `Với chu kỳ này, hàng đợi ${queueSize} thông báo phủ khoảng ${rounded} giờ; app bổ sung khi bạn mở app hoặc đổi cài đặt.`;
  }
  return null;
}

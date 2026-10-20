/**
 * Local-time date helpers. Streaks and daily goals must follow the phone's
 * timezone, never UTC, because a study session at 23:30 in Hanoi must count
 * for that calendar day.
 */

export const MS_PER_DAY = 86_400_000;

export function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function atTime(date: Date, hour: number, minute: number): Date {
  const copy = startOfDay(date);
  copy.setHours(hour, minute, 0, 0);
  return copy;
}

export function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

/** YYYY-MM-DD in local time. */
export function dateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map((part) => Number(part));
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day);
}

export function isSameDay(a: Date | string, b: Date | string): boolean {
  const left = typeof a === 'string' ? new Date(a) : a;
  const right = typeof b === 'string' ? new Date(b) : b;
  return dateKey(left) === dateKey(right);
}

export function tomorrowAt(hour = 4, minute = 0): Date {
  const next = addDays(startOfDay(new Date()), 1);
  next.setHours(hour, minute, 0, 0);
  return next;
}

export function formatRelativeDue(iso: string | null): string {
  if (!iso) return 'Chưa học';
  const due = new Date(iso).getTime();
  const now = Date.now();
  const diffDays = Math.round((due - now) / MS_PER_DAY);
  if (Number.isNaN(diffDays)) return 'Chưa học';
  if (diffDays < 0) return `Quá hạn ${Math.abs(diffDays)} ngày`;
  if (diffDays === 0) return 'Hôm nay';
  if (diffDays === 1) return 'Ngày mai';
  if (diffDays < 30) return `${diffDays} ngày nữa`;
  return new Date(iso).toLocaleDateString('vi-VN');
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return '<1s';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}p${seconds % 60 ? ` ${seconds % 60}s` : ''}`;
}

export function lastNDays(n: number, end: Date = new Date()): string[] {
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i -= 1) keys.push(dateKey(addDays(end, -i)));
  return keys;
}

const numberFormat = new Intl.NumberFormat('vi-VN');

export function num(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return numberFormat.format(value);
}

export function dateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
}

export function shortId(value: string): string {
  return value.slice(0, 8);
}

// Khớp thang của app: 0 = mất gốc, 1..6 = A1…C2 (xem src/types.ts).
const LEVELS = ['STARTER', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

export function levelShort(level: number | null | undefined): string {
  if (level === null || level === undefined) return '—';
  return LEVELS[level] ?? `L${level}`;
}

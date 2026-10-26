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

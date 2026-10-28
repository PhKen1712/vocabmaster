import type { SQLiteDatabase } from 'expo-sqlite';

import type { StreakBaseline } from '../streak/streak';

/**
 * Mốc streak do quản trị viên đặt (bảng `streak_grants` phía server).
 *
 * Lưu trong `app_settings` chứ không phải `daily_activity`: đây KHÔNG phải một
 * ngày học. Ghi nó vào lịch sử hoạt động sẽ làm sai số từ mới, độ chính xác và
 * biểu đồ 30 ngày.
 *
 * Chỉ giữ mốc MỚI NHẤT. Mỗi lần quản trị viên điều chỉnh là một mốc mới thay
 * thế mốc cũ; lịch sử đầy đủ nằm ở server để kiểm toán.
 */

const KEY = 'streak_baseline';

export async function loadStreakBaseline(db: SQLiteDatabase): Promise<StreakBaseline | null> {
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_settings WHERE key = ?;',
    [KEY],
  );
  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(row.value) as { date?: unknown; days?: unknown };
    if (typeof parsed.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) return null;
    const days = typeof parsed.days === 'number' ? Math.round(parsed.days) : 0;
    if (!Number.isFinite(days) || days < 0) return null;
    return { date: parsed.date, days: Math.min(days, 3650) };
  } catch {
    return null;
  }
}

export async function saveStreakBaseline(
  db: SQLiteDatabase,
  baseline: StreakBaseline,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
    [KEY, JSON.stringify(baseline)],
  );
}

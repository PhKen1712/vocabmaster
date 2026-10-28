import type { SQLiteDatabase } from 'expo-sqlite';
import type { SupabaseClient } from '@supabase/supabase-js';

import { saveStreakBaseline } from '../db/streakBaseline';
import { getMeta, setMeta } from './outbox';

/**
 * Nhận mốc streak do quản trị viên đặt.
 *
 * Không đi qua `sync_push`/`sync_pull`: hai hàm đó chỉ truyền dữ liệu người học
 * tự tạo và đang được dùng cho hàng nghìn bản ghi mỗi lần. Một lời gọi nhỏ, chỉ
 * chạy khi đồng bộ, là đủ và không phải đổi hợp đồng của hai hàm cũ.
 *
 * Đánh dấu `grantId` đã áp dụng để mốc cũ không quay lại ghi đè sau khi người
 * học đã tiếp tục chuỗi bằng hoạt động thật.
 */
export async function refreshStreakBaseline(
  db: SQLiteDatabase,
  client: SupabaseClient,
): Promise<boolean> {
  const { data, error } = await client.rpc('my_streak_baseline');
  if (error || !data) return false;

  const payload = data as {
    date?: string | null;
    days?: number;
    grantId?: string | null;
  };
  if (!payload.grantId || !payload.date) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.date)) return false;

  const applied = await getMeta(db, 'streak_grant_applied');
  if (applied === payload.grantId) return false;

  await saveStreakBaseline(db, {
    date: payload.date,
    days: Math.max(0, Math.min(3650, Math.round(payload.days ?? 0))),
  });
  await setMeta(db, 'streak_grant_applied', payload.grantId);
  return true;
}

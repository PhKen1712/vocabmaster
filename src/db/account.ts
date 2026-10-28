import type { SQLiteDatabase } from 'expo-sqlite';

import { resetDatabase } from './database';

/**
 * Tài khoản đang sở hữu dữ liệu trên MÁY NÀY.
 *
 * Vì sao phải ghi lại: SQLite trên máy là một kho duy nhất, không tự tách theo
 * tài khoản. Khi ứng dụng bắt buộc đăng nhập, nếu người dùng A đăng xuất rồi
 * người dùng B đăng nhập trên cùng máy, dữ liệu của A sẽ bị đẩy lên tài khoản B
 * nếu không có chốt chặn. Ghi lại chủ sở hữu cho phép phát hiện đúng tình huống
 * đó và hỏi trước khi xoá dữ liệu cục bộ.
 *
 * Server vẫn là nơi giữ bản gốc: xoá dữ liệu máy không xoá dữ liệu của A trên
 * tài khoản A.
 */

const OWNER_KEY = 'account_owner';

export interface AccountOwner {
  id: string;
  email: string | null;
}

export async function readAccountOwner(db: SQLiteDatabase): Promise<AccountOwner | null> {
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_settings WHERE key = ?;',
    [OWNER_KEY],
  );
  if (!row?.value) return null;
  const raw = row.value.trim();
  // Bản đầu chỉ lưu user id; đọc được cả hai dạng.
  if (!raw.startsWith('{')) return { id: raw, email: null };
  try {
    const parsed = JSON.parse(raw) as { id?: unknown; email?: unknown };
    if (typeof parsed.id !== 'string' || !parsed.id) return null;
    return { id: parsed.id, email: typeof parsed.email === 'string' ? parsed.email : null };
  } catch {
    return null;
  }
}

export async function writeAccountOwner(
  db: SQLiteDatabase,
  owner: AccountOwner,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
    [OWNER_KEY, JSON.stringify(owner)],
  );
}

/**
 * Bàn giao máy cho một tài khoản khác.
 *
 * Chỉ gọi sau khi người dùng đã xác nhận. Toàn bộ dữ liệu học cục bộ (từ vựng,
 * tiến độ, album, xu đã ghi trên máy) bị xoá; hàng đợi và mốc đồng bộ cũng bị
 * xoá để không đẩy dữ liệu của tài khoản trước sang tài khoản mới. Dữ liệu trên
 * máy chủ của tài khoản cũ không bị ảnh hưởng.
 */
export async function switchLocalAccountTo(
  db: SQLiteDatabase,
  owner: AccountOwner,
): Promise<void> {
  await resetDatabase(db);
  await db.execAsync('DELETE FROM sync_outbox; DELETE FROM sync_meta;');
  await writeAccountOwner(db, owner);
}

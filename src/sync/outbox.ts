/**
 * Hàng đợi thay đổi chờ gửi lên tài khoản.
 *
 * Vì sao có hàng đợi thay vì gọi mạng ngay: học phải chạy được khi mất mạng.
 * Mọi thao tác ghi SQLite xong thì đánh dấu "cần gửi" ở đây; khi có mạng, engine
 * gom lại gửi một lần. Gửi thất bại thì dòng vẫn nằm nguyên trong hàng đợi —
 * không có chuyện dữ liệu biến mất vì wifi yếu.
 */

import type { SQLiteDatabase } from 'expo-sqlite';

import { newId, nowIso } from '../lib/ids';

export type OutboxEntity =
  | 'word'
  | 'progress'
  | 'review'
  | 'activity'
  | 'album'
  | 'album_item'
  | 'album_item_removed'
  | 'word_removed'
  | 'coin'
  | 'settings'
  | 'reset';

export interface OutboxRow {
  id: string;
  entity: OutboxEntity;
  op: string;
  payload: string;
  created_at: string;
  attempts: number;
  last_error: string | null;
}

const MAX_ATTEMPTS = 12;
const BATCH = 400;

/**
 * Ghi một thay đổi vào hàng đợi.
 *
 * Không chặn luồng học: nếu ghi hàng đợi lỗi, ta không ném ra ngoài — dữ liệu
 * học đã nằm an toàn trong bảng gốc, và lần đồng bộ đầy đủ kế tiếp sẽ quét lại.
 */
export async function enqueue(
  db: SQLiteDatabase,
  entity: OutboxEntity,
  payload: Record<string, unknown> = {},
): Promise<void> {
  try {
    await db.runAsync(
      `INSERT INTO sync_outbox (id, entity, op, payload, created_at) VALUES (?, ?, 'upsert', ?, ?);`,
      [newId(), entity, JSON.stringify(payload), nowIso()],
    );
  } catch (error) {
    console.warn('Không ghi được hàng đợi đồng bộ', error);
  }
}

/** Đánh dấu một tập thay đổi cần gửi (dùng khi reset cả thư viện). */
export async function enqueueMany(
  db: SQLiteDatabase,
  entries: { entity: OutboxEntity; payload?: Record<string, unknown> }[],
): Promise<void> {
  for (const entry of entries) {
    await enqueue(db, entry.entity, entry.payload ?? {});
  }
}

/** Số thay đổi đang chờ — hiển thị cho người học biết còn gì chưa lên server. */
export async function pendingCount(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM sync_outbox;');
  return row?.n ?? 0;
}

export async function pendingRows(db: SQLiteDatabase, limit = BATCH): Promise<OutboxRow[]> {
  return db.getAllAsync<OutboxRow>(
    `SELECT * FROM sync_outbox ORDER BY created_at ASC LIMIT ?;`,
    [limit],
  );
}

/**
 * Gom hàng đợi thành danh sách việc cần gửi, đã loại trùng.
 *
 * Cùng một từ sửa năm lần chỉ cần gửi một lần: payload luôn được dựng lại từ
 * trạng thái hiện tại trong database, nên bản mới nhất luôn thắng.
 */
export interface PendingWork {
  wordIds: Set<string>;
  progressIds: Set<string>;
  reviewIds: Set<string>;
  activityDays: Set<string>;
  albumIds: Set<string>;
  albumItemIds: Set<string>;
  removedAlbumItemIds: Set<string>;
  coinIds: Set<string>;
  settings: boolean;
  ids: string[];
  stale: number;
}

export function collect(rows: OutboxRow[]): PendingWork {
  const work: PendingWork = {
    wordIds: new Set(),
    progressIds: new Set(),
    reviewIds: new Set(),
    activityDays: new Set(),
    albumIds: new Set(),
    albumItemIds: new Set(),
    removedAlbumItemIds: new Set(),
    coinIds: new Set(),
    settings: false,
    ids: [],
    stale: 0,
  };

  for (const row of rows) {
    work.ids.push(row.id);
    // Sau nhiều lần thất bại, bỏ qua dòng cũ: dữ liệu vẫn nằm trong bảng gốc,
    // và lần "đồng bộ đầy đủ" sẽ gửi lại toàn bộ. Giữ mãi một dòng hỏng sẽ
    // chặn cả hàng đợi phía sau nó.
    if (row.attempts >= MAX_ATTEMPTS) {
      work.stale += 1;
      continue;
    }
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(row.payload) as Record<string, unknown>;
    } catch {
      payload = {};
    }
    const id = typeof payload.id === 'string' ? payload.id : '';
    const day = typeof payload.day === 'string' ? payload.day : '';
    switch (row.entity) {
      case 'word':
        if (id) work.wordIds.add(id);
        break;
      case 'progress':
        if (id) work.progressIds.add(id);
        break;
      case 'review':
        if (id) work.reviewIds.add(id);
        break;
      case 'activity':
        if (day) work.activityDays.add(day);
        break;
      case 'album':
        work.albumIds.add(id || 'default');
        break;
      case 'album_item':
        if (id) work.albumItemIds.add(id);
        break;
      case 'album_item_removed':
      case 'word_removed':
        if (id) work.removedAlbumItemIds.add(id);
        break;
      case 'coin':
        if (id) work.coinIds.add(id);
        break;
      case 'settings':
        work.settings = true;
        break;
      default:
        break;
    }
  }

  return work;
}

export async function markSent(db: SQLiteDatabase, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  await db.runAsync(`DELETE FROM sync_outbox WHERE id IN (${placeholders});`, ids);
}

export async function markFailed(db: SQLiteDatabase, ids: string[], error: string): Promise<void> {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  await db.runAsync(
    `UPDATE sync_outbox SET attempts = attempts + 1, last_error = ? WHERE id IN (${placeholders});`,
    [error.slice(0, 300), ...ids],
  );
}

// ---------------------------------------------------------------------------
// Bộ nhớ phụ trợ (watermark, mã thiết bị)
// ---------------------------------------------------------------------------

export async function getMeta(db: SQLiteDatabase, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM sync_meta WHERE key = ?;',
    [key],
  );
  return row?.value ?? null;
}

export async function setMeta(db: SQLiteDatabase, key: string, value: string): Promise<void> {
  await db.runAsync(
    `INSERT INTO sync_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
    [key, value],
  );
}

/** Mã thiết bị ổn định, sinh một lần rồi giữ nguyên. */
export async function deviceId(db: SQLiteDatabase): Promise<string> {
  const existing = await getMeta(db, 'device_id');
  if (existing) return existing;
  const created = `dev-${newId().slice(0, 8)}`;
  await setMeta(db, 'device_id', created);
  return created;
}

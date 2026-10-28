/**
 * Bộ máy đồng bộ.
 *
 * Một vòng chạy gồm hai nửa, luôn theo thứ tự này:
 *   1. ĐẨY  — gom mọi thay đổi đang chờ trong outbox, gửi một gói lên server.
 *   2. KÉO  — hỏi server những gì đã đổi kể từ mốc lần trước, rồi trộn vào SQLite.
 *
 * Nguyên tắc không được vi phạm:
 *   - Mất mạng thì KHÔNG mất dữ liệu: gói nào chưa gửi được vẫn nằm trong outbox.
 *   - Số dư xu không do máy khách quyết định; xu chỉ đi qua public.award_coins.
 *   - Không ghi đè tiến độ bằng bản cũ (xem `progressPatch`).
 */

import type { SQLiteDatabase } from 'expo-sqlite';

import { getCloudClient } from '../cloud/client';
import { newId, nowIso } from '../lib/ids';
import type { Settings } from '../types';
import type { ActivityRow, ReviewRow, WordRow } from '../db/schema';
import {
  albumFromSettings,
  albumItemFromRow,
  coinFromRow,
  activityFromRow,
  emptyPayload,
  progressFromWord,
  progressPatch,
  recheckSince,
  reviewFromRow,
  termFromWord,
  type ProgressPush,
  type PulledWord,
  type SyncPayload,
} from './map';
import { deviceId, getMeta, markFailed, markSent, pendingCount, setMeta } from './outbox';
import { refreshStreakBaseline } from './streakGrant';

export interface SyncOutcome {
  ok: boolean;
  pushed: number;
  pulled: number;
  error?: string;
}

function chunk<T>(items: T[], size = 80): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

async function rowsById<T>(
  db: SQLiteDatabase,
  sql: string,
  ids: string[],
): Promise<T[]> {
  const out: T[] = [];
  for (const group of chunk(ids)) {
    const placeholders = group.map(() => '?').join(',');
    out.push(...(await db.getAllAsync<T>(sql.replace('{{ids}}', placeholders), group)));
  }
  return out;
}

/** Mã album ổn định giữa các thiết bị (sinh một lần cho mỗi người dùng). */
async function albumClientId(db: SQLiteDatabase): Promise<string> {
  const existing = await getMeta(db, 'album_client_id');
  if (existing) return existing;
  const created = `album-${newId().slice(0, 8)}`;
  await setMeta(db, 'album_client_id', created);
  return created;
}

async function localIdFor(
  db: SQLiteDatabase,
  term: string,
  track: string,
): Promise<string | null> {
  const row = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM words WHERE normalized_term = ? AND track = ? LIMIT 1;',
    [normalize(term), track === 'ielts' ? 'ielts' : 'general'],
  );
  return row?.id ?? null;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

// ---------------------------------------------------------------------------
// Dựng gói đẩy
/**
 * Dựng gói đẩy lên server.
 *
 * Cách làm: quét theo MỐC THỜI GIAN (`last_push_at`) thay vì bắt từng chỗ ghi
 * phải nhớ gọi đồng bộ. Nhờ vậy một chức năng mới thêm sau này không thể vô tình
 * quên đồng bộ — chỉ cần nó ghi vào database là được gửi đi. Việc xoá là ngoại lệ
 * (xoá thì không còn dòng nào để quét), nên những thao tác đó ghi vào outbox.
 */
export async function buildPayload(
  db: SQLiteDatabase,
  settings: Settings,
  options: { full?: boolean } = {},
): Promise<{ payload: SyncPayload; ids: string[] }> {
  const payload = emptyPayload();
  const epoch = '1970-01-01T00:00:00.000Z';
  const since = options.full ? epoch : ((await getMeta(db, 'last_push_at')) ?? epoch);
  // Hai tham số vì mệnh đề WHERE so cả mốc sửa dòng lẫn mốc thao tác yêu thích.
  const sinceArgs = [since, since];

  const words = await db.getAllAsync<WordRow>(
    // `favorite_at` được xét riêng: có trường hợp dòng không sửa gì nhưng lựa
    // chọn yêu thích vừa được xác lập lại (ví dụ máy chủ đang giữ giá trị cũ
    // không có mốc thao tác) — khi đó vẫn phải đẩy lên để hai bên khớp nhau.
    'SELECT * FROM words WHERE updated_at > ? OR COALESCE(favorite_at, \'\') > ? ORDER BY updated_at ASC LIMIT 500;',
    sinceArgs,
  );
  for (const word of words) {
    payload.terms.push(termFromWord(word));
    payload.user_words.push(progressFromWord(word));
  }

  const reviews = await db.getAllAsync<ReviewRow & { term: string; track: string }>(
    `SELECT r.*, w.term AS term, w.track AS track FROM reviews r
       JOIN words w ON w.id = r.word_id
      WHERE r.reviewed_at > ? ORDER BY r.reviewed_at ASC LIMIT 500;`,
    [since],
  );
  for (const review of reviews) payload.reviews.push(reviewFromRow(review, review.term, review.track));

  const activity = await db.getAllAsync<ActivityRow>(
    'SELECT * FROM daily_activity WHERE updated_at > ? ORDER BY date ASC LIMIT 120;',
    [since],
  );
  for (const day of activity) payload.daily_activity.push(activityFromRow(day));

  const albumRows = await db.getAllAsync<
    { word_id: string; added_at: string; last_notified_at: string | null; notify_count: number; term: string; track: string }
  >(
    `SELECT a.*, w.term AS term, w.track AS track FROM album_words a
       JOIN words w ON w.id = a.word_id
      WHERE a.added_at > ? ORDER BY a.added_at ASC LIMIT 500;`,
    [since],
  );
  for (const row of albumRows) payload.album_items.push(albumItemFromRow(row, row.term, row.track));

  const coins = await db.getAllAsync<Parameters<typeof coinFromRow>[0] & { id: string }>(
    'SELECT * FROM coin_ledger WHERE created_at > ? ORDER BY created_at ASC LIMIT 500;',
    [since],
  );
  for (const row of coins) {
    const push = coinFromRow(row);
    if (push) payload.coins.push(push);
  }

  // ------------------------------------------------------------------ xoá
  const removals = await db.getAllAsync<{ entity: string; payload: string }>(
    `SELECT entity, payload FROM sync_outbox
      WHERE entity IN ('album_item_removed', 'word_removed') AND attempts < 12;`,
  );
  for (const row of removals) {
    let parsed: { term?: string; track?: string; deletedAt?: string } = {};
    try {
      parsed = JSON.parse(row.payload) as typeof parsed;
    } catch {
      continue;
    }
    if (!parsed.term) continue;
    if (row.entity === 'album_item_removed') {
      payload.album_items.push({
        term: parsed.term,
        track: parsed.track === 'ielts' ? 'ielts' : 'general',
        addedAt: epoch,
        deletedAt: parsed.deletedAt ?? nowIso(),
        lastNotifiedAt: null,
        notifyCount: 0,
      });
    } else {
      // Từ bị xoá khỏi thư viện: giữ lại nội dung dùng chung, chỉ đánh dấu
      // tiến độ của riêng người này là đã xoá.
      payload.user_words.push({
        term: parsed.term,
        track: parsed.track === 'ielts' ? 'ielts' : 'general',
        learningState: 'new',
        dueAt: null,
        stability: 0,
        difficulty: 0,
        reps: 0,
        lapses: 0,
        correctCount: 0,
        wrongCount: 0,
        hintCount: 0,
        lastCorrectAt: null,
        lastWrongAt: null,
        memoryRating: null,
        isFavorite: false,
        updatedAt: parsed.deletedAt ?? nowIso(),
        deletedAt: parsed.deletedAt ?? nowIso(),
      } as ProgressPush & { deletedAt: string });
    }
  }

  // ------------------------------------------------------- cờ từ outbox
  const flags = await db.getAllAsync<{ entity: string }>(
    `SELECT DISTINCT entity FROM sync_outbox
      WHERE entity IN ('album', 'settings') AND attempts < 12;`,
  );
  const flagSet = new Set(flags.map((row) => row.entity));

  if (options.full || flagSet.has('album') || albumRows.length > 0) {
    payload.album = albumFromSettings(settings, await albumClientId(db));
  }
  if (options.full || flagSet.has('settings')) {
    payload.settings = settings as unknown as Record<string, unknown>;
  }

  const ids = await db.getAllAsync<{ id: string }>('SELECT id FROM sync_outbox WHERE attempts < 12;');

  return { payload, ids: ids.map((row) => row.id) };
}

async function albumMembers(
  db: SQLiteDatabase,
  onlyWordIds?: string[],
): Promise<ReturnType<typeof albumItemFromRow>[]> {
  const query = onlyWordIds
    ? `SELECT a.*, w.term AS term, w.track AS track FROM album_words a
       JOIN words w ON w.id = a.word_id WHERE a.word_id IN (${onlyWordIds
         .map(() => '?')
         .join(',')});`
    : `SELECT a.*, w.term AS term, w.track AS track FROM album_words a
       JOIN words w ON w.id = a.word_id;`;
  const rows = await db.getAllAsync<
    { word_id: string; added_at: string; last_notified_at: string | null; notify_count: number; term: string; track: string }
  >(query, onlyWordIds ?? []);
  return rows.map((row) => albumItemFromRow(row, row.term, row.track));
}

// ---------------------------------------------------------------------------
// Trộn dữ liệu kéo về
// ---------------------------------------------------------------------------

export interface PulledPayload {
  server_time: string;
  words: PulledWord[];
  reviews: {
    id: string;
    term: string;
    rating: number | null;
    correct: boolean | null;
    mode: string | null;
    reviewedAt: string;
  }[];
  daily_activity:
    | ActivityRow[]
    | {
        day: string;
        newWords: number;
        reviews: number;
        answered: number;
        correct: number;
        goalMet?: boolean;
      }[];
  albums: { clientId: string | null; intervalMinutes: number; notifyEnabled: boolean; startHour: number; endHour: number }[];
  album_items: { term: string; track?: string; termId: string; addedAt: string; deletedAt: string | null; lastNotifiedAt: string | null; notifyCount: number }[];
  coins: { id: string; kind: string; amount: number; balanceAfter: number; reason: string | null; sourceId: string; cycleId: string | null; createdAt: string }[];
  settings: Record<string, unknown> | null;
}

export async function applyPull(
  db: SQLiteDatabase,
  pulled: PulledPayload,
  options: { settingsPending: boolean } = { settingsPending: false },
): Promise<number> {
  let applied = 0;

  for (const incoming of pulled.words ?? []) {
    const track = incoming.track === 'ielts' ? 'ielts' : 'general';
    const local = await db.getFirstAsync<WordRow>(
      'SELECT * FROM words WHERE normalized_term = ? AND track = ? LIMIT 1;',
      [incoming.normalizedTerm ?? normalize(incoming.term), track],
    );

    const patch = progressPatch(local, incoming);

    if (!local) {
      // Từ được thêm ở thiết bị khác: tạo nguyên dòng để người học thấy ngay.
      const createdAt = nowIso();
      await db.runAsync(
        // 37 cột, đúng thứ tự bên dưới. `topic` và `note`/`audio_url` để NULL:
        // server không giữ chủ đề cho từng người, và app chưa có ghi chú/audio.
        `INSERT OR IGNORE INTO words (
           id, term, normalized_term, ipa, part_of_speech, meaning_vi, definition_en,
           example_en, example_vi, synonyms, antonyms, collocations, word_family,
           topic, track, level, source, ai_generated, confirmed, note, audio_url,
           is_favorite, learning_state, due_at, stability, difficulty, reps, lapses,
           last_reviewed_at, created_at, updated_at,
           correct_count, wrong_count, hint_count, last_correct_at, last_wrong_at, memory_rating,
           favorite_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,?,1,NULL,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?);`,
        [
          newId(),
          incoming.term,
          incoming.normalizedTerm ?? normalize(incoming.term),
          incoming.ipa,
          incoming.partOfSpeech,
          incoming.meaningVi ?? '',
          incoming.definitionEn,
          incoming.exampleEn,
          incoming.exampleVi,
          JSON.stringify(incoming.synonyms ?? []),
          JSON.stringify(incoming.antonyms ?? []),
          JSON.stringify(incoming.collocations ?? []),
          JSON.stringify(incoming.wordFamilyText ? [incoming.wordFamilyText] : []),
          track,
          Math.max(0, Math.min(6, incoming.level ?? 2)),
          'sync',
          0,
          patch?.isFavorite ? 1 : 0,
          patch?.learningState ?? 'new',
          patch?.dueAt ?? null,
          patch?.stability ?? 0,
          patch?.difficulty ?? 0,
          patch?.reps ?? 0,
          patch?.lapses ?? 0,
          patch?.lastCorrectAt ?? null,
          createdAt,
          incoming.updatedAt ?? createdAt,
          patch?.correctCount ?? 0,
          patch?.wrongCount ?? 0,
          patch?.hintCount ?? 0,
          patch?.lastCorrectAt ?? null,
          patch?.lastWrongAt ?? null,
          patch?.memoryRating ?? null,
          patch?.favoriteAt ?? null,
        ],
      );
      applied += 1;
      continue;
    }

    if (!patch) continue;

    // Nội dung chỉ ghi đè khi bản trên server mới hơn: sửa từ trên máy này rồi
    // chưa kịp đẩy lên thì không bị kéo về bản cũ.
    const contentWins = (incoming.updatedAt ?? '') >= (local.updated_at ?? '');
    await db.runAsync(
      `UPDATE words SET
         ${contentWins ? 'ipa = ?, part_of_speech = ?, meaning_vi = ?, definition_en = ?, example_en = ?, example_vi = ?, synonyms = ?, antonyms = ?, collocations = ?, level = ?, ' : ''}
         is_favorite = ?, learning_state = ?, due_at = ?, stability = ?, difficulty = ?,
         reps = ?, lapses = ?, correct_count = ?, wrong_count = ?, hint_count = ?,
         last_correct_at = ?, last_wrong_at = ?, memory_rating = ?, favorite_at = ?, updated_at = ?
       WHERE id = ?;`,
      [
        ...(contentWins
          ? [
              incoming.ipa ?? local.ipa,
              incoming.partOfSpeech ?? local.part_of_speech,
              incoming.meaningVi ?? local.meaning_vi,
              incoming.definitionEn ?? local.definition_en,
              incoming.exampleEn ?? local.example_en,
              incoming.exampleVi ?? local.example_vi,
              JSON.stringify(incoming.synonyms ?? []),
              JSON.stringify(incoming.antonyms ?? []),
              JSON.stringify(incoming.collocations ?? []),
              Math.max(0, Math.min(6, incoming.level ?? local.level)),
            ]
          : []),
        patch.isFavorite ? 1 : 0,
        patch.learningState,
        patch.dueAt,
        patch.stability,
        patch.difficulty,
        patch.reps,
        patch.lapses,
        patch.correctCount,
        patch.wrongCount,
        patch.hintCount,
        patch.lastCorrectAt,
        patch.lastWrongAt,
        patch.memoryRating,
        patch.favoriteAt,
        patch.updatedAt,
        local.id,
      ],
    );
    applied += 1;
  }

  for (const review of pulled.reviews ?? []) {
    const wordId = await localIdFor(db, review.term, 'general');
    if (!wordId) continue;
    await db.runAsync(
      `INSERT OR IGNORE INTO reviews (
         id, word_id, rating, correct, mode, duration_ms, reviewed_at,
         previous_interval_days, next_interval_days
       ) VALUES (?,?,?,?,?,0,?,0,0);`,
      [review.id, wordId, review.rating ?? 3, review.correct ? 1 : 0, review.mode ?? 'sync', review.reviewedAt],
    );
    applied += 1;
  }

  for (const day of pulled.daily_activity ?? []) {
    const normalized = {
      date: (day as { day?: string }).day ?? (day as ActivityRow).date,
      new_words: (day as ActivityRow).new_words ?? (day as { newWords?: number }).newWords ?? 0,
      reviews: (day as ActivityRow).reviews ?? 0,
      answered: (day as ActivityRow).answered ?? 0,
      correct: (day as ActivityRow).correct ?? 0,
      // Bản server cũ không có trường này; khi đó giữ nguyên cờ đang có ở máy
      // thay vì ghi đè bằng false (ghi đè sẽ làm mất ngày đã hoàn thành mục
      // tiêu và rút ngắn chuỗi ngày học một cách âm thầm).
      goal_met:
        typeof (day as { goalMet?: boolean }).goalMet === 'boolean'
          ? ((day as { goalMet?: boolean }).goalMet ? 1 : 0)
          : null,
    };
    if (!normalized.date) continue;
    await db.runAsync(
      `INSERT INTO daily_activity (date, new_words, reviews, answered, correct, goal_met, updated_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(date) DO UPDATE SET
         new_words = MAX(daily_activity.new_words, excluded.new_words),
         reviews   = MAX(daily_activity.reviews, excluded.reviews),
         answered  = MAX(daily_activity.answered, excluded.answered),
         correct   = MAX(daily_activity.correct, excluded.correct),
         goal_met  = MAX(daily_activity.goal_met, excluded.goal_met),
         updated_at = excluded.updated_at;`,
      [
        normalized.date,
        normalized.new_words,
        normalized.reviews,
        normalized.answered,
        normalized.correct,
        normalized.goal_met ?? 0,
        nowIso(),
      ],
    );
    applied += 1;
  }

  for (const item of pulled.album_items ?? []) {
    const wordId = await localIdFor(db, item.term, item.track ?? 'general');
    if (!wordId) continue;
    if (item.deletedAt) {
      // Xoá khỏi album chỉ xoá liên kết, không đụng tới từ hay tiến độ.
      await db.runAsync('DELETE FROM album_words WHERE word_id = ?;', [wordId]);
      applied += 1;
      continue;
    }
    await db.runAsync(
      `INSERT INTO album_words (word_id, added_at, last_notified_at, notify_count)
       VALUES (?,?,?,?)
       ON CONFLICT(word_id) DO UPDATE SET
         last_notified_at = COALESCE(excluded.last_notified_at, album_words.last_notified_at),
         notify_count = MAX(album_words.notify_count, excluded.notify_count);`,
      [wordId, item.addedAt ?? nowIso(), item.lastNotifiedAt, item.notifyCount ?? 0],
    );
    applied += 1;
  }

  for (const coin of pulled.coins ?? []) {
    await db.runAsync(
      `INSERT OR IGNORE INTO coin_ledger
         (id, kind, word_id, amount, balance_after, reason, created_at, term_key, source_id, cycle_id)
       VALUES (?,?,NULL,?,?,?,?,NULL,?,?);`,
      [
        coin.id,
        coin.kind === 'penalty' ? 'penalty' : 'reward',
        coin.amount,
        coin.balanceAfter,
        coin.reason,
        coin.createdAt,
        coin.sourceId,
        coin.cycleId,
      ],
    );
    applied += 1;
  }

  // Cài đặt chỉ áp khi máy này không có thay đổi đang chờ, để không nuốt mất
  // lựa chọn người học vừa bấm.
  if (!options.settingsPending && pulled.settings && Object.keys(pulled.settings).length > 0) {
    await db.runAsync(
      `INSERT INTO app_settings (key, value) VALUES ('settings', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
      [JSON.stringify(pulled.settings)],
    );
  }

  return applied;
}

// ---------------------------------------------------------------------------
// Vòng đồng bộ
// ---------------------------------------------------------------------------

export interface SyncOptions {
  settings: Settings;
  /** Gửi toàn bộ thư viện trên máy lên tài khoản (lần đăng nhập đầu tiên). */
  full?: boolean;
}

export async function syncNow(db: SQLiteDatabase, options: SyncOptions): Promise<SyncOutcome> {
  const client = getCloudClient();
  if (!client) return { ok: false, pushed: 0, pulled: 0, error: 'Chưa cấu hình Supabase.' };

  const { data: sessionData } = await client.auth.getSession();
  if (!sessionData.session) {
    return { ok: false, pushed: 0, pulled: 0, error: 'Chưa đăng nhập.' };
  }

  const pushOnce = async (
    full: boolean,
  ): Promise<{ ok: true; pushed: number } | { ok: false; pushed: number; error: string }> => {
    const { payload, ids } = await buildPayload(db, options.settings, { full });
    const hasContent =
      payload.terms.length + payload.user_words.length + payload.reviews.length +
        payload.daily_activity.length + payload.album_items.length + payload.coins.length > 0 ||
      payload.album !== null ||
      payload.settings !== undefined;
    if (!hasContent) return { ok: true, pushed: 0 };

    const { data, error } = await client.rpc('sync_push', {
      p_payload: payload,
      p_device_id: await deviceId(db),
      p_platform: process.env.EXPO_OS ?? 'app',
      p_app_version: '0.1.0',
    });

    if (error) {
      const message = describeSyncError(error.message);
      await markFailed(db, ids, error.message);
      return { ok: false, pushed: 0, error: message };
    }

    const applied = (data as { applied?: Record<string, number> } | null)?.applied ?? {};
    const count = Object.values(applied).reduce((sum, value) => sum + (typeof value === 'number' ? value : 0), 0);
    await markSent(db, ids);
    await setMeta(db, 'last_push_at', nowIso());
    return { ok: true, pushed: count };
  };

  const firstPush = await pushOnce(options.full === true);
  if (!firstPush.ok) return { ok: false, pushed: 0, pulled: 0, error: firstPush.error };
  let pushed = firstPush.pushed;

  // Kéo về: mốc thời gian do server trả, không dùng giờ máy — đồng hồ điện thoại
  // lệch vài phút là đủ để bỏ sót thay đổi của thiết bị khác.
  const since = await getMeta(db, 'last_pulled_at');
  const pull = await client.rpc('sync_pull', { p_since: recheckSince(since) });
  if (pull.error) {
    return { ok: false, pushed, pulled: 0, error: describeSyncError(pull.error.message) };
  }

  const pulled = pull.data as PulledPayload | null;
  let pulledCount = 0;
  if (pulled) {
    pulledCount = await applyPull(db, pulled, { settingsPending: false });
    await setMeta(db, 'last_pulled_at', pulled.server_time ?? nowIso());
  }

  // Mốc streak do quản trị viên đặt không nằm trong sync_pull (nó không phải dữ
  // liệu học), nên hỏi riêng. Đổi mốc được tính như một thay đổi đã kéo để các
  // màn hình đọc lại số liệu ngay.
  try {
    if (await refreshStreakBaseline(db, client)) pulledCount += 1;
  } catch {
    // Không lấy được mốc không làm hỏng dữ liệu học: lần đồng bộ sau thử lại.
  }

  // Lần kéo vừa rồi có thể đã xác lập lại lựa chọn yêu thích của máy này (khi
  // máy chủ đang giữ giá trị cũ không có mốc thao tác — xem `progressPatch`).
  // Đẩy thêm một lượt ngay trong cùng lần đồng bộ để máy chủ khớp lại luôn, chứ
  // không phải đợi tới lần mở app sau mới đúng.
  const pushMark = await getMeta(db, 'last_push_at');
  if (pulledCount > 0 && pushMark) {
    const pendingFavorite = await db.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM words WHERE COALESCE(favorite_at, '') > ?;",
      [pushMark],
    );
    if ((pendingFavorite?.n ?? 0) > 0) {
      const secondPush = await pushOnce(false);
      if (secondPush.ok) pushed += secondPush.pushed;
    }
  }

  return { ok: true, pushed, pulled: pulledCount };
}

/**
 * Đặt tiến độ học về chưa học, trên CẢ hai phía.
 *
 * Gọi server trước: nếu server chưa xong thì không được xoá dữ liệu máy, vì như
 * vậy hai bên sẽ lệch nhau và lần đồng bộ sau lại kéo tiến độ cũ về.
 */
export async function syncResetProgress(
  db: SQLiteDatabase,
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  const client = getCloudClient();
  const { data: sessionData } = client ? await client.auth.getSession() : { data: { session: null } };

  if (client && sessionData.session) {
    const { error } = await client.rpc('reset_study_progress', { p_reason: reason });
    if (error) return { ok: false, error: describeSyncError(error.message) };
  }

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE words SET learning_state = 'new', due_at = NULL, stability = 0, difficulty = 0,
         reps = 0, lapses = 0, correct_count = 0, wrong_count = 0, hint_count = 0,
         last_correct_at = NULL, last_wrong_at = NULL, memory_rating = NULL,
         last_reviewed_at = NULL, updated_at = ?;`,
      [nowIso()],
    );
    await db.execAsync('DELETE FROM reviews;');
    await db.execAsync('DELETE FROM daily_activity;');
  });

  return { ok: true };
}

export function describeSyncError(message: string): string {
  if (/Failed to send|Network request failed|fetch/i.test(message)) {
    return 'Không gửi được lên máy chủ. Dữ liệu vẫn nằm trên máy và sẽ được gửi lại khi có mạng.';
  }
  if (/JWT|jwt|401|token/i.test(message)) return 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.';
  if (/42501/.test(message) || message.includes('khoá')) {
    return 'Tài khoản đang bị khoá nên không đồng bộ được.';
  }
  return message;
}

export { pendingCount };

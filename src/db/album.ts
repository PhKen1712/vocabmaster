import type { SQLiteDatabase } from 'expo-sqlite';

import { nowIso } from '../lib/ids';
import type { Level, Word } from '../types';
import { rowToWord, type WordRow } from './schema';

/**
 * The Album is a membership relation, not a copy of the vocabulary bank.
 *
 * `album_words.word_id` references `words.id` with ON DELETE CASCADE, so:
 * - editing meaning/level/example in the bank is immediately visible here;
 * - a word can be added only once;
 * - deleting a word removes its album entry and its scheduled picks.
 *
 * The album table also carries the only notification state: when a word was
 * last sent and how many times. Nothing here touches reviews, coins or streak.
 */

export type AlbumSort =
  | 'album_recent'
  | 'album_oldest'
  | 'alpha'
  | 'alpha_desc'
  | 'level_asc'
  | 'level_desc'
  | 'due';

export interface AlbumQuery {
  search?: string;
  level?: Level;
  topic?: string;
  sort?: AlbumSort;
  limit?: number;
}

export async function addWordsToAlbum(
  db: SQLiteDatabase,
  wordIds: readonly string[],
): Promise<number> {
  const ids = [...new Set(wordIds.filter(Boolean))];
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(', ');
  let added = 0;
  await db.withTransactionAsync(async () => {
    const result = await db.runAsync(
      `INSERT OR IGNORE INTO album_words (word_id, added_at)
       SELECT id, ? FROM words WHERE id IN (${placeholders});`,
      [nowIso(), ...ids],
    );
    added = result.changes;
  });
  return added;
}

export async function removeWordsFromAlbum(
  db: SQLiteDatabase,
  wordIds: readonly string[],
): Promise<number> {
  const ids = [...new Set(wordIds.filter(Boolean))];
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(', ');
  const result = await db.runAsync(
    `DELETE FROM album_words WHERE word_id IN (${placeholders});`,
    ids,
  );
  return result.changes;
}

export async function countAlbumWords(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM album_words;',
  );
  return row?.count ?? 0;
}

export async function isInAlbum(db: SQLiteDatabase, wordId: string): Promise<boolean> {
  const row = await db.getFirstAsync<{ word_id: string }>(
    'SELECT word_id FROM album_words WHERE word_id = ?;',
    [wordId],
  );
  return Boolean(row);
}

function albumOrder(sort: AlbumQuery['sort']): string {
  switch (sort) {
    case 'album_oldest':
      return 'ORDER BY a.added_at ASC, w.term COLLATE NOCASE ASC';
    case 'alpha':
      return 'ORDER BY w.term COLLATE NOCASE ASC';
    case 'alpha_desc':
      return 'ORDER BY w.term COLLATE NOCASE DESC';
    case 'level_asc':
      return 'ORDER BY w.level ASC, w.term COLLATE NOCASE ASC';
    case 'level_desc':
      return 'ORDER BY w.level DESC, w.term COLLATE NOCASE ASC';
    case 'due':
      return 'ORDER BY (w.due_at IS NULL) ASC, w.due_at ASC';
    case 'album_recent':
    default:
      return 'ORDER BY a.added_at DESC, w.term COLLATE NOCASE ASC';
  }
}

export async function listAlbumWords(
  db: SQLiteDatabase,
  query: AlbumQuery = {},
): Promise<Word[]> {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (typeof query.level === 'number') {
    conditions.push('w.level = ?');
    params.push(query.level);
  }
  if (query.topic?.trim()) {
    conditions.push('LOWER(TRIM(w.topic)) = LOWER(?)');
    params.push(query.topic.trim());
  }
  if (query.search?.trim()) {
    const needle = `%${query.search.trim().toLowerCase()}%`;
    conditions.push(
      "(LOWER(w.term) LIKE ? OR LOWER(w.meaning_vi) LIKE ? OR LOWER(COALESCE(w.topic, '')) LIKE ?)",
    );
    params.push(needle, needle, needle);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await db.getAllAsync<WordRow>(
    `SELECT w.*, 1 AS in_album FROM words w
     JOIN album_words a ON a.word_id = w.id
     ${where} ${albumOrder(query.sort)} LIMIT ?;`,
    [...params, query.limit ?? 500],
  );
  return rows.map(rowToWord);
}

export async function listAlbumWordIds(db: SQLiteDatabase): Promise<string[]> {
  const rows = await db.getAllAsync<{ word_id: string }>(
    'SELECT word_id FROM album_words ORDER BY added_at ASC;',
  );
  return rows.map((row) => row.word_id);
}

export async function listAlbumTopics(
  db: SQLiteDatabase,
): Promise<{ topic: string; count: number }[]> {
  const rows = await db.getAllAsync<{ topic: string; count: number }>(
    `SELECT w.topic AS topic, COUNT(*) AS count
     FROM words w JOIN album_words a ON a.word_id = w.id
     WHERE w.topic IS NOT NULL AND w.topic <> ''
     GROUP BY w.topic ORDER BY count DESC, w.topic ASC;`,
  );
  return rows;
}

export interface AlbumNotificationCandidate {
  id: string;
  term: string;
  meaningVi: string;
  exampleEn: string | null;
  exampleVi: string | null;
  level: Level;
  lastNotifiedAt: string | null;
  notifyCount: number;
}

/**
 * Every album word is a notification candidate. There is deliberately no
 * per-word opt-in: the learner opted in by adding the word to the album.
 */
export async function listAlbumNotificationCandidates(
  db: SQLiteDatabase,
  limits: { levelMin?: Level; levelMax?: Level } = {},
): Promise<AlbumNotificationCandidate[]> {
  const conditions = ['w.meaning_vi <> \'\''];
  const params: number[] = [];
  if (typeof limits.levelMin === 'number') {
    conditions.push('w.level >= ?');
    params.push(limits.levelMin);
  }
  if (typeof limits.levelMax === 'number') {
    conditions.push('w.level <= ?');
    params.push(limits.levelMax);
  }

  const rows = await db.getAllAsync<{
    id: string;
    term: string;
    meaning_vi: string;
    example_en: string | null;
    example_vi: string | null;
    level: number;
    last_notified_at: string | null;
    notify_count: number;
  }>(
    `SELECT w.id, w.term, w.meaning_vi, w.example_en, w.example_vi, w.level,
            a.last_notified_at, a.notify_count
     FROM words w JOIN album_words a ON a.word_id = w.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY COALESCE(a.last_notified_at, '') ASC, a.notify_count ASC;`,
    params,
  );

  return rows.map((row) => ({
    id: row.id,
    term: row.term,
    meaningVi: row.meaning_vi,
    exampleEn: row.example_en,
    exampleVi: row.example_vi,
    level: row.level as Level,
    lastNotifiedAt: row.last_notified_at,
    notifyCount: row.notify_count,
  }));
}

/** Record delivery intent at scheduling time so the next picks stay balanced. */
export async function markAlbumNotified(
  db: SQLiteDatabase,
  wordIds: readonly string[],
  at: string = nowIso(),
): Promise<void> {
  const ids = [...new Set(wordIds.filter(Boolean))];
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(', ');
  await db.runAsync(
    `UPDATE album_words
     SET last_notified_at = ?, notify_count = notify_count + 1
     WHERE word_id IN (${placeholders});`,
    [at, ...ids],
  );
}

export async function clearAlbum(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('DELETE FROM album_words;');
}

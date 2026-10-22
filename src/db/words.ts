import type { SQLiteDatabase } from 'expo-sqlite';

import type {
  LearningState,
  Level,
  Track,
  Word,
  WordInput,
  WordSource,
} from '../types';
import { nowIso, newId } from '../lib/ids';
import { normalizeTerm } from '../lib/text';
import {
  WORD_COLUMNS,
  rowToWord,
  wordInsertValues,
  type WordRow,
} from './schema';

export class DuplicateWordError extends Error {
  readonly existing: Word;

  constructor(existing: Word) {
    super(`Từ "${existing.term}" đã có trong bộ từ ${existing.track === 'ielts' ? 'IELTS' : 'General'}.`);
    this.name = 'DuplicateWordError';
    this.existing = existing;
  }
}

export interface WordQuery {
  track?: Track;
  level?: Level;
  topic?: string;
  favoriteOnly?: boolean;
  state?: LearningState;
  search?: string;
  dueOnly?: boolean;
  /** Only unconfirmed AI drafts (normally never persisted, kept for safety). */
  source?: WordSource;
  limit?: number;
  offset?: number;
  sort?: 'recent' | 'alpha' | 'due';
}

function buildWhere(query: WordQuery): { clause: string; params: (string | number)[] } {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (query.track) {
    conditions.push('track = ?');
    params.push(query.track);
  }
  if (typeof query.level === 'number') {
    conditions.push('level = ?');
    params.push(query.level);
  }
  if (query.topic) {
    conditions.push('topic = ?');
    params.push(query.topic);
  }
  if (query.favoriteOnly) {
    conditions.push('is_favorite = 1');
  }
  if (query.state) {
    conditions.push('learning_state = ?');
    params.push(query.state);
  }
  if (query.source) {
    conditions.push('source = ?');
    params.push(query.source);
  }
  if (query.search && query.search.trim()) {
    const needle = `%${query.search.trim().toLowerCase()}%`;
    conditions.push('(LOWER(term) LIKE ? OR LOWER(meaning_vi) LIKE ? OR LOWER(COALESCE(note, \'\')) LIKE ?)');
    params.push(needle, needle, needle);
  }
  if (query.dueOnly) {
    conditions.push('reps > 0 AND due_at IS NOT NULL AND due_at <= ?');
    params.push(nowIso());
  }

  return {
    clause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

function orderBy(sort: WordQuery['sort']): string {
  switch (sort) {
    case 'alpha':
      return 'ORDER BY term COLLATE NOCASE ASC';
    case 'due':
      return 'ORDER BY (due_at IS NULL) ASC, due_at ASC';
    case 'recent':
    default:
      return 'ORDER BY created_at DESC';
  }
}

export async function listWords(db: SQLiteDatabase, query: WordQuery = {}): Promise<Word[]> {
  const { clause, params } = buildWhere(query);
  const limit = query.limit ?? 200;
  const offset = query.offset ?? 0;
  const rows = await db.getAllAsync<WordRow>(
    `SELECT * FROM words ${clause} ${orderBy(query.sort)} LIMIT ? OFFSET ?;`,
    [...params, limit, offset],
  );
  return rows.map(rowToWord);
}

export async function countWords(db: SQLiteDatabase, query: WordQuery = {}): Promise<number> {
  const { clause, params } = buildWhere(query);
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM words ${clause};`,
    params,
  );
  return row?.count ?? 0;
}

export async function getWord(db: SQLiteDatabase, id: string): Promise<Word | null> {
  const row = await db.getFirstAsync<WordRow>('SELECT * FROM words WHERE id = ?;', [id]);
  return row ? rowToWord(row) : null;
}

export async function findWordByTerm(
  db: SQLiteDatabase,
  term: string,
  track: Track,
): Promise<Word | null> {
  const row = await db.getFirstAsync<WordRow>(
    'SELECT * FROM words WHERE normalized_term = ? AND track = ?;',
    [normalizeTerm(term), track],
  );
  return row ? rowToWord(row) : null;
}

/** Same spelling in the other track — used to warn, not to block. */
export async function findSameTermInOtherTrack(
  db: SQLiteDatabase,
  term: string,
  track: Track,
): Promise<Word | null> {
  const row = await db.getFirstAsync<WordRow>(
    'SELECT * FROM words WHERE normalized_term = ? AND track <> ? LIMIT 1;',
    [normalizeTerm(term), track],
  );
  return row ? rowToWord(row) : null;
}

export async function createWord(db: SQLiteDatabase, input: WordInput): Promise<Word> {
  const term = input.term.trim();
  if (!term) throw new Error('Từ tiếng Anh không được để trống.');
  if (!input.meaningVi.trim()) throw new Error('Nghĩa tiếng Việt không được để trống.');

  const track: Track = input.track ?? 'general';
  const existing = await findWordByTerm(db, term, track);
  if (existing) throw new DuplicateWordError(existing);

  const timestamp = nowIso();
  const word: Word = {
    id: newId(),
    term,
    normalizedTerm: normalizeTerm(term),
    ipa: input.ipa?.trim() || null,
    partOfSpeech: input.partOfSpeech?.trim() || null,
    meaningVi: input.meaningVi.trim(),
    definitionEn: input.definitionEn?.trim() || null,
    exampleEn: input.exampleEn?.trim() || null,
    exampleVi: input.exampleVi?.trim() || null,
    synonyms: input.synonyms ?? [],
    antonyms: input.antonyms ?? [],
    collocations: input.collocations ?? [],
    wordFamily: input.wordFamily ?? [],
    topic: input.topic?.trim() || null,
    track,
    level: input.level ?? 2,
    source: input.source ?? 'manual',
    aiGenerated: input.aiGenerated ?? false,
    confirmed: input.confirmed ?? true,
    note: input.note?.trim() || null,
    audioUrl: input.audioUrl?.trim() || null,
    dictSource: input.dictSource?.trim() || null,
    missingFields: input.missingFields ?? [],
    isFavorite: input.isFavorite ?? false,
    learningState: 'new',
    dueAt: null,
    stability: 0,
    difficulty: 0,
    reps: 0,
    lapses: 0,
    lastReviewedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const placeholders = WORD_COLUMNS.map(() => '?').join(', ');
  await db.runAsync(
    `INSERT INTO words (${WORD_COLUMNS.join(', ')}) VALUES (${placeholders});`,
    wordInsertValues(word),
  );
  return word;
}

export type WordPatch = Partial<WordInput> & {
  note?: string | null;
  isFavorite?: boolean;
  learningState?: LearningState;
};

export async function updateWord(
  db: SQLiteDatabase,
  id: string,
  patch: WordPatch,
): Promise<Word> {
  const current = await getWord(db, id);
  if (!current) throw new Error('Không tìm thấy từ cần sửa.');

  const term = patch.term !== undefined ? patch.term.trim() : current.term;
  if (!term) throw new Error('Từ tiếng Anh không được để trống.');
  const meaningVi =
    patch.meaningVi !== undefined ? patch.meaningVi.trim() : current.meaningVi;
  if (!meaningVi) throw new Error('Nghĩa tiếng Việt không được để trống.');

  const track = patch.track ?? current.track;
  const duplicate = await findWordByTerm(db, term, track);
  if (duplicate && duplicate.id !== id) throw new DuplicateWordError(duplicate);

  const next: Word = {
    ...current,
    term,
    normalizedTerm: normalizeTerm(term),
    ipa: patch.ipa !== undefined ? patch.ipa?.trim() || null : current.ipa,
    partOfSpeech:
      patch.partOfSpeech !== undefined
        ? patch.partOfSpeech?.trim() || null
        : current.partOfSpeech,
    meaningVi,
    definitionEn:
      patch.definitionEn !== undefined
        ? patch.definitionEn?.trim() || null
        : current.definitionEn,
    exampleEn:
      patch.exampleEn !== undefined ? patch.exampleEn?.trim() || null : current.exampleEn,
    exampleVi:
      patch.exampleVi !== undefined ? patch.exampleVi?.trim() || null : current.exampleVi,
    synonyms: patch.synonyms ?? current.synonyms,
    antonyms: patch.antonyms ?? current.antonyms,
    collocations: patch.collocations ?? current.collocations,
    wordFamily: patch.wordFamily ?? current.wordFamily,
    topic: patch.topic !== undefined ? patch.topic?.trim() || null : current.topic,
    track,
    level: patch.level ?? current.level,
    note: patch.note !== undefined ? patch.note?.trim() || null : current.note,
    audioUrl:
      patch.audioUrl !== undefined ? patch.audioUrl?.trim() || null : current.audioUrl,
    dictSource:
      patch.dictSource !== undefined
        ? patch.dictSource?.trim() || null
        : (current.dictSource ?? null),
    missingFields: patch.missingFields ?? current.missingFields ?? [],
    isFavorite: patch.isFavorite ?? current.isFavorite,
    learningState: patch.learningState ?? current.learningState,
    aiGenerated: patch.aiGenerated ?? current.aiGenerated,
    confirmed: patch.confirmed ?? current.confirmed,
    updatedAt: nowIso(),
  };

  await db.runAsync(
    `UPDATE words SET
      term = ?, normalized_term = ?, ipa = ?, part_of_speech = ?, meaning_vi = ?,
      definition_en = ?, example_en = ?, example_vi = ?, synonyms = ?, antonyms = ?,
      collocations = ?, word_family = ?, topic = ?, track = ?, level = ?,
      source = ?, ai_generated = ?, confirmed = ?, note = ?, audio_url = ?,
      dict_source = ?, missing_fields = ?,
      is_favorite = ?, learning_state = ?, updated_at = ?
     WHERE id = ?;`,
    [
      next.term,
      next.normalizedTerm,
      next.ipa,
      next.partOfSpeech,
      next.meaningVi,
      next.definitionEn,
      next.exampleEn,
      next.exampleVi,
      JSON.stringify(next.synonyms),
      JSON.stringify(next.antonyms),
      JSON.stringify(next.collocations),
      JSON.stringify(next.wordFamily),
      next.topic,
      next.track,
      next.level,
      next.source,
      next.aiGenerated ? 1 : 0,
      next.confirmed ? 1 : 0,
      next.note,
      next.audioUrl,
      next.dictSource ?? null,
      JSON.stringify(next.missingFields ?? []),
      next.isFavorite ? 1 : 0,
      next.learningState,
      next.updatedAt,
      id,
    ],
  );

  return next;
}

export async function deleteWord(db: SQLiteDatabase, id: string): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM reviews WHERE word_id = ?;', [id]);
    await db.runAsync('DELETE FROM words WHERE id = ?;', [id]);
  });
}

export async function setFavorite(
  db: SQLiteDatabase,
  id: string,
  favorite: boolean,
): Promise<void> {
  await db.runAsync('UPDATE words SET is_favorite = ?, updated_at = ? WHERE id = ?;', [
    favorite ? 1 : 0,
    nowIso(),
    id,
  ]);
}

export interface Counts {
  total: number;
  due: number;
  fresh: number;
  learning: number;
  review: number;
  known: number;
  favorites: number;
}

export async function getCounts(db: SQLiteDatabase, track?: Track): Promise<Counts> {
  const trackClause = track ? 'AND track = ?' : '';
  const params = track ? [track] : [];
  const row = await db.getFirstAsync<{
    total: number;
    due: number;
    fresh: number;
    learning: number;
    review: number;
    known: number;
    favorites: number;
  }>(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN reps > 0 AND due_at IS NOT NULL AND due_at <= ? THEN 1 ELSE 0 END) AS due,
       SUM(CASE WHEN reps = 0 THEN 1 ELSE 0 END) AS fresh,
       SUM(CASE WHEN learning_state IN ('learning', 'relearning') THEN 1 ELSE 0 END) AS learning,
       SUM(CASE WHEN learning_state = 'review' THEN 1 ELSE 0 END) AS review,
       SUM(CASE WHEN learning_state = 'known' THEN 1 ELSE 0 END) AS known,
       SUM(CASE WHEN is_favorite = 1 THEN 1 ELSE 0 END) AS favorites
     FROM words WHERE 1 = 1 ${trackClause};`,
    [nowIso(), ...params],
  );

  return {
    total: row?.total ?? 0,
    due: row?.due ?? 0,
    fresh: row?.fresh ?? 0,
    learning: row?.learning ?? 0,
    review: row?.review ?? 0,
    known: row?.known ?? 0,
    favorites: row?.favorites ?? 0,
  };
}

/** Words that are due now, oldest due date first. */
export async function getDueWords(
  db: SQLiteDatabase,
  track: Track,
  limit: number,
): Promise<Word[]> {
  const rows = await db.getAllAsync<WordRow>(
    `SELECT * FROM words
     WHERE track = ? AND reps > 0 AND due_at IS NOT NULL AND due_at <= ?
     ORDER BY due_at ASC LIMIT ?;`,
    [track, nowIso(), limit],
  );
  return rows.map(rowToWord);
}

/**
 * New words for a session, preferring the learner's current level and then
 * slightly easier levels so a "mất gốc" learner can still make progress.
 */
export async function getNewWords(
  db: SQLiteDatabase,
  track: Track,
  level: Level,
  limit: number,
): Promise<Word[]> {
  const rows = await db.getAllAsync<WordRow>(
    `SELECT * FROM words
     WHERE track = ? AND reps = 0
     ORDER BY ABS(level - ?) ASC, created_at ASC LIMIT ?;`,
    [track, level, limit],
  );
  return rows.map(rowToWord);
}

export interface StudyPlan {
  due: Word[];
  fresh: Word[];
}

export async function buildStudyPlan(
  db: SQLiteDatabase,
  track: Track,
  level: Level,
  newLimit: number,
  reviewLimit: number,
): Promise<StudyPlan> {
  const due = await getDueWords(db, track, reviewLimit);
  const fresh = await getNewWords(db, track, level, newLimit);
  return { due, fresh };
}

/** Deterministic "word of the day" per track and local date. */
export async function getWordOfTheDay(
  db: SQLiteDatabase,
  track: Track,
  dateKey: string,
): Promise<Word | null> {
  const count = await countWords(db, { track });
  if (count === 0) return null;
  let hash = 0;
  const seed = `${track}:${dateKey}`;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 1_000_003;
  }
  const row = await db.getFirstAsync<WordRow>(
    `SELECT * FROM words WHERE track = ? ORDER BY created_at ASC, id ASC LIMIT 1 OFFSET ?;`,
    [track, hash % count],
  );
  return row ? rowToWord(row) : null;
}

/**
 * Words the learner keeps getting wrong: wrong answers in the last 45 days,
 * weighted by lapse count.
 */
export async function getWeakWords(
  db: SQLiteDatabase,
  track: Track,
  limit = 20,
): Promise<{ word: Word; wrongCount: number }[]> {
  const since = new Date(Date.now() - 45 * 86_400_000).toISOString();
  const rows = await db.getAllAsync<WordRow & { wrong_count: number }>(
    `SELECT w.*, COUNT(r.id) AS wrong_count
     FROM words w
     JOIN reviews r ON r.word_id = w.id
     WHERE w.track = ? AND r.correct = 0 AND r.reviewed_at >= ?
     GROUP BY w.id
     ORDER BY wrong_count DESC, w.lapses DESC
     LIMIT ?;`,
    [track, since, limit],
  );
  return rows.map((row) => ({ word: rowToWord(row), wrongCount: row.wrong_count ?? 0 }));
}

export async function getTopics(
  db: SQLiteDatabase,
  track?: Track,
): Promise<{ topic: string; count: number }[]> {
  const rows = await db.getAllAsync<{ topic: string; count: number }>(
    `SELECT topic, COUNT(*) AS count FROM words
     WHERE topic IS NOT NULL AND topic <> '' ${track ? 'AND track = ?' : ''}
     GROUP BY topic ORDER BY count DESC, topic ASC;`,
    track ? [track] : [],
  );
  return rows;
}

export async function getLevelBreakdown(
  db: SQLiteDatabase,
  track: Track,
): Promise<{ level: number; total: number; learned: number }[]> {
  const rows = await db.getAllAsync<{ level: number; total: number; learned: number }>(
    `SELECT level,
       COUNT(*) AS total,
       SUM(CASE WHEN reps > 0 THEN 1 ELSE 0 END) AS learned
     FROM words WHERE track = ? GROUP BY level ORDER BY level ASC;`,
    [track],
  );
  return rows;
}

export async function getAllWords(db: SQLiteDatabase): Promise<Word[]> {
  const rows = await db.getAllAsync<WordRow>('SELECT * FROM words ORDER BY created_at ASC;');
  return rows.map(rowToWord);
}

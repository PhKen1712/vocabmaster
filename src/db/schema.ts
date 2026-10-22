import type {
  DailyActivity,
  LearningState,
  Level,
  ReviewLog,
  ReviewRating,
  Track,
  Word,
  WordField,
  WordSource,
} from '../types';

export const SCHEMA_VERSION = 2;

/**
 * Forward-only migrations. Every entry runs exactly once, inside a transaction.
 * Never edit a released migration: add a new version instead so existing study
 * data is preserved when the app updates.
 */
export const MIGRATIONS: { version: number; statements: string[] }[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS words (
        id TEXT PRIMARY KEY NOT NULL,
        term TEXT NOT NULL,
        normalized_term TEXT NOT NULL,
        ipa TEXT,
        part_of_speech TEXT,
        meaning_vi TEXT NOT NULL DEFAULT '',
        definition_en TEXT,
        example_en TEXT,
        example_vi TEXT,
        synonyms TEXT NOT NULL DEFAULT '[]',
        antonyms TEXT NOT NULL DEFAULT '[]',
        collocations TEXT NOT NULL DEFAULT '[]',
        word_family TEXT NOT NULL DEFAULT '[]',
        topic TEXT,
        track TEXT NOT NULL DEFAULT 'general',
        level INTEGER NOT NULL DEFAULT 2,
        source TEXT NOT NULL DEFAULT 'manual',
        ai_generated INTEGER NOT NULL DEFAULT 0,
        confirmed INTEGER NOT NULL DEFAULT 1,
        note TEXT,
        audio_url TEXT,
        is_favorite INTEGER NOT NULL DEFAULT 0,
        learning_state TEXT NOT NULL DEFAULT 'new',
        due_at TEXT,
        stability REAL NOT NULL DEFAULT 0,
        difficulty REAL NOT NULL DEFAULT 0,
        reps INTEGER NOT NULL DEFAULT 0,
        lapses INTEGER NOT NULL DEFAULT 0,
        last_reviewed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_words_term_track
        ON words (normalized_term, track);`,
      `CREATE INDEX IF NOT EXISTS idx_words_due ON words (due_at);`,
      `CREATE INDEX IF NOT EXISTS idx_words_track_level ON words (track, level);`,
      `CREATE TABLE IF NOT EXISTS reviews (
        id TEXT PRIMARY KEY NOT NULL,
        word_id TEXT NOT NULL,
        rating INTEGER NOT NULL,
        correct INTEGER NOT NULL DEFAULT 0,
        mode TEXT NOT NULL DEFAULT 'manual',
        duration_ms INTEGER NOT NULL DEFAULT 0,
        reviewed_at TEXT NOT NULL,
        previous_interval_days REAL NOT NULL DEFAULT 0,
        next_interval_days REAL NOT NULL DEFAULT 0,
        FOREIGN KEY (word_id) REFERENCES words (id) ON DELETE CASCADE
      );`,
      `CREATE INDEX IF NOT EXISTS idx_reviews_word ON reviews (word_id, reviewed_at DESC);`,
      `CREATE INDEX IF NOT EXISTS idx_reviews_date ON reviews (reviewed_at);`,
      `CREATE TABLE IF NOT EXISTS daily_activity (
        date TEXT PRIMARY KEY NOT NULL,
        new_words INTEGER NOT NULL DEFAULT 0,
        reviews INTEGER NOT NULL DEFAULT 0,
        answered INTEGER NOT NULL DEFAULT 0,
        correct INTEGER NOT NULL DEFAULT 0,
        goal_met INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );`,
      `CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );`,
    ],
  },
  {
    version: 2,
    statements: [
      // Provenance for looked-up words: where the data came from and what is
      // still missing. Existing rows keep working with NULL / empty list.
      `ALTER TABLE words ADD COLUMN dict_source TEXT;`,
      `ALTER TABLE words ADD COLUMN missing_fields TEXT NOT NULL DEFAULT '[]';`,
      // Answers from the dictionaries, so a word is never fetched twice.
      `CREATE TABLE IF NOT EXISTS dictionary_cache (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        fetched_at INTEGER NOT NULL
      );`,
      `CREATE INDEX IF NOT EXISTS idx_dict_cache_fetched ON dictionary_cache (fetched_at);`,
    ],
  },
];

export interface WordRow {
  id: string;
  term: string;
  normalized_term: string;
  ipa: string | null;
  part_of_speech: string | null;
  meaning_vi: string;
  definition_en: string | null;
  example_en: string | null;
  example_vi: string | null;
  synonyms: string;
  antonyms: string;
  collocations: string;
  word_family: string;
  topic: string | null;
  track: string;
  level: number;
  source: string;
  ai_generated: number;
  confirmed: number;
  note: string | null;
  audio_url: string | null;
  dict_source?: string | null;
  missing_fields?: string | null;
  is_favorite: number;
  learning_state: string;
  due_at: string | null;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  last_reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReviewRow {
  id: string;
  word_id: string;
  rating: number;
  correct: number;
  mode: string;
  duration_ms: number;
  reviewed_at: string;
  previous_interval_days: number;
  next_interval_days: number;
}

export interface ActivityRow {
  date: string;
  new_words: number;
  reviews: number;
  answered: number;
  correct: number;
  goal_met: number;
  updated_at: string;
}

function parseList(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function asTrack(value: string): Track {
  return value === 'ielts' ? 'ielts' : 'general';
}

function asSource(value: string): WordSource {
  if (value === 'ai' || value === 'seed' || value === 'import' || value === 'dictionary') {
    return value;
  }
  return 'manual';
}

function asLearningState(value: string): LearningState {
  if (
    value === 'learning' ||
    value === 'review' ||
    value === 'relearning' ||
    value === 'known'
  ) {
    return value;
  }
  return 'new';
}

function asLevel(value: number): Level {
  const rounded = Math.round(value);
  if (rounded < 0) return 0;
  if (rounded > 6) return 6;
  return rounded as Level;
}

export function rowToWord(row: WordRow): Word {
  return {
    id: row.id,
    term: row.term,
    normalizedTerm: row.normalized_term,
    ipa: row.ipa,
    partOfSpeech: row.part_of_speech,
    meaningVi: row.meaning_vi,
    definitionEn: row.definition_en,
    exampleEn: row.example_en,
    exampleVi: row.example_vi,
    synonyms: parseList(row.synonyms),
    antonyms: parseList(row.antonyms),
    collocations: parseList(row.collocations),
    wordFamily: parseList(row.word_family),
    topic: row.topic,
    track: asTrack(row.track),
    level: asLevel(row.level),
    source: asSource(row.source),
    aiGenerated: row.ai_generated === 1,
    confirmed: row.confirmed === 1,
    note: row.note,
    audioUrl: row.audio_url,
    dictSource: row.dict_source ?? null,
    missingFields: parseList(row.missing_fields ?? null) as WordField[],
    isFavorite: row.is_favorite === 1,
    learningState: asLearningState(row.learning_state),
    dueAt: row.due_at,
    stability: row.stability,
    difficulty: row.difficulty,
    reps: row.reps,
    lapses: row.lapses,
    lastReviewedAt: row.last_reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToReview(row: ReviewRow): ReviewLog {
  const rating = row.rating >= 1 && row.rating <= 4 ? (row.rating as ReviewRating) : 3;
  return {
    id: row.id,
    wordId: row.word_id,
    rating,
    correct: row.correct === 1,
    mode: row.mode as ReviewLog['mode'],
    durationMs: row.duration_ms,
    reviewedAt: row.reviewed_at,
    previousIntervalDays: row.previous_interval_days,
    nextIntervalDays: row.next_interval_days,
  };
}

export function rowToActivity(row: ActivityRow): DailyActivity {
  return {
    date: row.date,
    newWords: row.new_words,
    reviews: row.reviews,
    answered: row.answered,
    correct: row.correct,
    goalMet: row.goal_met === 1,
  };
}

/** All word columns in a stable order, used by INSERT/SELECT statements. */
export const WORD_COLUMNS = [
  'id',
  'term',
  'normalized_term',
  'ipa',
  'part_of_speech',
  'meaning_vi',
  'definition_en',
  'example_en',
  'example_vi',
  'synonyms',
  'antonyms',
  'collocations',
  'word_family',
  'topic',
  'track',
  'level',
  'source',
  'ai_generated',
  'confirmed',
  'note',
  'audio_url',
  'dict_source',
  'missing_fields',
  'is_favorite',
  'learning_state',
  'due_at',
  'stability',
  'difficulty',
  'reps',
  'lapses',
  'last_reviewed_at',
  'created_at',
  'updated_at',
] as const;

export function wordInsertValues(word: Word): (string | number | null)[] {
  return [
    word.id,
    word.term,
    word.normalizedTerm,
    word.ipa,
    word.partOfSpeech,
    word.meaningVi,
    word.definitionEn,
    word.exampleEn,
    word.exampleVi,
    JSON.stringify(word.synonyms),
    JSON.stringify(word.antonyms),
    JSON.stringify(word.collocations),
    JSON.stringify(word.wordFamily),
    word.topic,
    word.track,
    word.level,
    word.source,
    word.aiGenerated ? 1 : 0,
    word.confirmed ? 1 : 0,
    word.note,
    word.audioUrl,
    word.dictSource ?? null,
    JSON.stringify(word.missingFields ?? []),
    word.isFavorite ? 1 : 0,
    word.learningState,
    word.dueAt,
    word.stability,
    word.difficulty,
    word.reps,
    word.lapses,
    word.lastReviewedAt,
    word.createdAt,
    word.updatedAt,
  ];
}

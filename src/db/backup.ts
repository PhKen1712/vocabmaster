import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import type { SQLiteDatabase } from 'expo-sqlite';
import * as Sharing from 'expo-sharing';

import { dateKey } from '../lib/date';
import { newId, nowIso } from '../lib/ids';
import { normalizeTerm, parseCsv, splitList, toCsvCell, uniqueStrings } from '../lib/text';
import { DEFAULT_SETTINGS } from '../types';
import type {
  BackupPayload,
  DailyActivity,
  LearningState,
  Level,
  ReviewLog,
  Settings,
  Track,
  Word,
  WordInput,
} from '../types';
import { getAllActivity } from './activity';
import { saveSettings } from './settings';
import { WORD_COLUMNS, wordInsertValues } from './schema';
import { getAllWords } from './words';

// ---------------------------------------------------------------------------
// JSON backup
// ---------------------------------------------------------------------------

export async function buildBackup(db: SQLiteDatabase): Promise<BackupPayload> {
  const [words, activity, settingsRow, reviewRows] = await Promise.all([
    getAllWords(db),
    getAllActivity(db),
    db.getFirstAsync<{ value: string }>(
      "SELECT value FROM app_settings WHERE key = 'settings';",
    ),
    db.getAllAsync<{
      id: string;
      word_id: string;
      rating: number;
      correct: number;
      mode: string;
      duration_ms: number;
      reviewed_at: string;
      previous_interval_days: number;
      next_interval_days: number;
    }>('SELECT * FROM reviews ORDER BY reviewed_at ASC;'),
  ]);

  let settings: Settings | null = null;
  if (settingsRow?.value) {
    try {
      settings = JSON.parse(settingsRow.value) as Settings;
    } catch {
      settings = null;
    }
  }

  const reviews: ReviewLog[] = reviewRows.map((row) => ({
    id: row.id,
    wordId: row.word_id,
    rating: row.rating as ReviewLog['rating'],
    correct: row.correct === 1,
    mode: row.mode as ReviewLog['mode'],
    durationMs: row.duration_ms,
    reviewedAt: row.reviewed_at,
    previousIntervalDays: row.previous_interval_days,
    nextIntervalDays: row.next_interval_days,
  }));

  return {
    format: 'vocabmaster-backup',
    version: 1,
    exportedAt: nowIso(),
    settings: settings ?? { ...DEFAULT_SETTINGS },
    words,
    reviews,
    activity,
  };
}

export interface ExportedFile {
  uri: string;
  fileName: string;
  shared: boolean;
}

export async function exportBackupFile(db: SQLiteDatabase): Promise<ExportedFile> {
  const payload = await buildBackup(db);
  const directory = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
  if (!directory) throw new Error('Thiết bị không có thư mục tạm để ghi file.');
  const fileName = `vocabmaster-backup-${dateKey()}.json`;
  const uri = `${directory}${fileName}`;
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(payload, null, 2), {
    encoding: FileSystem.EncodingType.UTF8,
  });
  const shared = await Sharing.isAvailableAsync();
  if (shared) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/json',
      dialogTitle: 'Lưu bản sao lưu VocabMaster',
      UTI: 'public.json',
    });
  }
  return { uri, fileName, shared };
}

export async function pickTextFile(): Promise<{ content: string; name: string } | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/plain', 'text/csv', 'text/comma-separated-values'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return null;
  const asset = result.assets?.[0];
  if (!asset) return null;
  const content = await FileSystem.readAsStringAsync(asset.uri);
  return { content, name: asset.name ?? 'file' };
}

function clampLevel(value: unknown, fallback: Level): Level {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  if (rounded < 0) return 0;
  if (rounded > 6) return 6;
  return rounded as Level;
}

function asTrack(value: unknown, fallback: Track): Track {
  return value === 'ielts' || value === 'general' ? value : fallback;
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(
    value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()),
  );
}

function coerceWord(
  raw: unknown,
  index: number,
  errors: string[],
): Word | null {
  if (!raw || typeof raw !== 'object') {
    errors.push(`Từ #${index + 1}: không phải object.`);
    return null;
  }
  const record = raw as Record<string, unknown>;
  const term = asStringOrNull(record.term);
  const meaningVi = asStringOrNull(record.meaningVi);
  if (!term) {
    errors.push(`Từ #${index + 1}: thiếu "term".`);
    return null;
  }
  if (!meaningVi) {
    errors.push(`Từ #${index + 1} (${term}): thiếu "meaningVi".`);
    return null;
  }
  const timestamp = nowIso();
  const learningState = (['new', 'learning', 'review', 'relearning', 'known'] as const).includes(
    record.learningState as LearningState,
  )
    ? (record.learningState as LearningState)
    : 'new';
  const track = asTrack(record.track, 'general');

  return {
    id: typeof record.id === 'string' && record.id ? record.id : newId(),
    term,
    normalizedTerm: normalizeTerm(term),
    ipa: asStringOrNull(record.ipa),
    partOfSpeech: asStringOrNull(record.partOfSpeech),
    meaningVi,
    definitionEn: asStringOrNull(record.definitionEn),
    exampleEn: asStringOrNull(record.exampleEn),
    exampleVi: asStringOrNull(record.exampleVi),
    synonyms: asStringArray(record.synonyms),
    antonyms: asStringArray(record.antonyms),
    collocations: asStringArray(record.collocations),
    wordFamily: asStringArray(record.wordFamily),
    topic: asStringOrNull(record.topic),
    track,
    level: clampLevel(record.level, 2),
    source:
      record.source === 'ai' || record.source === 'seed' || record.source === 'import'
        ? record.source
        : 'import',
    aiGenerated: Boolean(record.aiGenerated),
    confirmed: record.confirmed !== false,
    note: asStringOrNull(record.note),
    audioUrl: asStringOrNull(record.audioUrl),
    isFavorite: Boolean(record.isFavorite),
    learningState,
    dueAt: asStringOrNull(record.dueAt),
    stability: typeof record.stability === 'number' ? Math.max(0, record.stability) : 0,
    difficulty: typeof record.difficulty === 'number' ? Math.min(10, Math.max(1, record.difficulty)) : 0,
    reps: typeof record.reps === 'number' ? Math.max(0, Math.round(record.reps)) : 0,
    lapses: typeof record.lapses === 'number' ? Math.max(0, Math.round(record.lapses)) : 0,
    lastReviewedAt: asStringOrNull(record.lastReviewedAt),
    createdAt: asStringOrNull(record.createdAt) ?? timestamp,
    updatedAt: asStringOrNull(record.updatedAt) ?? timestamp,
  };
}

export interface ImportSummary {
  added: number;
  skipped: number;
  errors: string[];
}

export type RestoreMode = 'merge' | 'replace';

/**
 * Restore a JSON backup.
 *
 * - "merge" keeps existing study data and only inserts words that do not exist
 *   in the same track. Settings are not overwritten.
 * - "replace" wipes words/reviews/activity first, inside a transaction, so a
 *   failure leaves the previous data intact (the UI asks for confirmation).
 */
export async function restoreBackup(
  db: SQLiteDatabase,
  json: string,
  mode: RestoreMode,
): Promise<ImportSummary> {
  let parsed: Partial<BackupPayload>;
  try {
    parsed = JSON.parse(json) as Partial<BackupPayload>;
  } catch {
    throw new Error('File không phải JSON hợp lệ.');
  }

  if (parsed.format !== 'vocabmaster-backup' || !Array.isArray(parsed.words)) {
    throw new Error('File không phải bản sao lưu VocabMaster hợp lệ.');
  }

  const errors: string[] = [];
  const words: Word[] = [];
  const seen = new Set<string>();
  parsed.words.forEach((raw, index) => {
    const word = coerceWord(raw, index, errors);
    if (!word) return;
    const key = `${word.track}:${word.normalizedTerm}`;
    if (seen.has(key)) {
      errors.push(`"${word.term}" bị trùng trong file, chỉ giữ bản đầu tiên.`);
      return;
    }
    seen.add(key);
    words.push(word);
  });

  if (words.length === 0) {
    return { added: 0, skipped: 0, errors: errors.length ? errors : ['File không có từ nào hợp lệ.'] };
  }

  const reviewRows: ReviewLog[] = Array.isArray(parsed.reviews)
    ? parsed.reviews.filter(
        (row): row is ReviewLog =>
          Boolean(row) &&
          typeof (row as ReviewLog).wordId === 'string' &&
          typeof (row as ReviewLog).reviewedAt === 'string',
      )
    : [];
  const activityRows: DailyActivity[] = Array.isArray(parsed.activity)
    ? parsed.activity.filter(
        (row): row is DailyActivity =>
          Boolean(row) &&
          typeof (row as DailyActivity).date === 'string' &&
          /^\d{4}-\d{2}-\d{2}$/.test((row as DailyActivity).date),
      )
    : [];

  let added = 0;
  let skipped = 0;
  const placeholders = WORD_COLUMNS.map(() => '?').join(', ');

  await db.withTransactionAsync(async () => {
    if (mode === 'replace') {
      await db.execAsync('DELETE FROM reviews;');
      await db.execAsync('DELETE FROM daily_activity;');
      // Coins and streak repairs belong to the data being replaced; keeping
      // them would leave rewards pointing at words that no longer exist.
      await db.execAsync('DELETE FROM coin_ledger;');
      await db.execAsync('DELETE FROM streak_restores;');
      await db.execAsync('DELETE FROM words;');
    }

    for (const word of words) {
      const existing = await db.getFirstAsync<{ id: string }>(
        'SELECT id FROM words WHERE normalized_term = ? AND track = ?;',
        [word.normalizedTerm, word.track],
      );
      if (existing) {
        skipped += 1;
        continue;
      }
      try {
        await db.runAsync(
          `INSERT INTO words (${WORD_COLUMNS.join(', ')}) VALUES (${placeholders});`,
          wordInsertValues(word),
        );
        added += 1;
      } catch (error) {
        errors.push(
          `Không thêm được "${word.term}": ${error instanceof Error ? error.message : 'lỗi không rõ'}`,
        );
      }
    }

    if (mode === 'replace') {
      for (const review of reviewRows) {
        try {
          await db.runAsync(
            `INSERT OR IGNORE INTO reviews
              (id, word_id, rating, correct, mode, duration_ms, reviewed_at,
               previous_interval_days, next_interval_days)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            [
              review.id,
              review.wordId,
              review.rating,
              review.correct ? 1 : 0,
              review.mode ?? 'manual',
              review.durationMs ?? 0,
              review.reviewedAt,
              review.previousIntervalDays ?? 0,
              review.nextIntervalDays ?? 0,
            ],
          );
        } catch {
          errors.push('Một lượt ôn trong file không khôi phục được (bỏ qua).');
        }
      }
      for (const day of activityRows) {
        await db.runAsync(
          `INSERT OR REPLACE INTO daily_activity
            (date, new_words, reviews, answered, correct, goal_met, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?);`,
          [
            day.date,
            day.newWords ?? 0,
            day.reviews ?? 0,
            day.answered ?? 0,
            day.correct ?? 0,
            day.goalMet ? 1 : 0,
            nowIso(),
          ],
        );
      }
    }
  });

  if (mode === 'replace' && parsed.settings) {
    await saveSettings(db, parsed.settings);
  }

  return { added, skipped, errors };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

export const CSV_HEADERS = [
  'term',
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
  'note',
] as const;

const HEADER_ALIASES: Record<string, (typeof CSV_HEADERS)[number]> = {
  term: 'term',
  word: 'term',
  english: 'term',
  tu: 'term',
  'từ': 'term',
  ipa: 'ipa',
  pronunciation: 'ipa',
  part_of_speech: 'part_of_speech',
  pos: 'part_of_speech',
  type: 'part_of_speech',
  loai_tu: 'part_of_speech',
  meaning_vi: 'meaning_vi',
  meaning: 'meaning_vi',
  vietnamese: 'meaning_vi',
  nghia: 'meaning_vi',
  'nghĩa': 'meaning_vi',
  definition_en: 'definition_en',
  definition: 'definition_en',
  example_en: 'example_en',
  example: 'example_en',
  example_vi: 'example_vi',
  example_translation: 'example_vi',
  synonyms: 'synonyms',
  antonyms: 'antonyms',
  collocations: 'collocations',
  word_family: 'word_family',
  topic: 'topic',
  track: 'track',
  level: 'level',
  note: 'note',
};

function canonicalHeader(value: string): (typeof CSV_HEADERS)[number] | null {
  const key = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^\p{L}\p{N}_]/gu, '');
  return HEADER_ALIASES[key] ?? null;
}

export function wordsToCsv(words: readonly Word[]): string {
  const lines = [CSV_HEADERS.join(',')];
  for (const word of words) {
    lines.push(
      [
        toCsvCell(word.term),
        toCsvCell(word.ipa),
        toCsvCell(word.partOfSpeech),
        toCsvCell(word.meaningVi),
        toCsvCell(word.definitionEn),
        toCsvCell(word.exampleEn),
        toCsvCell(word.exampleVi),
        toCsvCell(word.synonyms.join('|')),
        toCsvCell(word.antonyms.join('|')),
        toCsvCell(word.collocations.join('|')),
        toCsvCell(word.wordFamily.join('|')),
        toCsvCell(word.topic),
        toCsvCell(word.track),
        toCsvCell(String(word.level)),
        toCsvCell(word.note),
      ].join(','),
    );
  }
  return lines.join('\n');
}

export function parseCsvWords(
  text: string,
  defaults: { track: Track; level: Level },
): { inputs: WordInput[]; errors: string[] } {
  const rows = parseCsv(text);
  const errors: string[] = [];
  if (rows.length < 2) {
    return { inputs: [], errors: ['File CSV cần dòng tiêu đề và ít nhất một dòng dữ liệu.'] };
  }

  const headerRow = rows[0] ?? [];
  const mapping = headerRow.map(canonicalHeader);
  if (!mapping.includes('term') || !mapping.includes('meaning_vi')) {
    return {
      inputs: [],
      errors: ['Dòng đầu tiên phải có cột "term" và "meaning_vi" (hoặc "word" và "meaning").'],
    };
  }

  const inputs: WordInput[] = [];
  const seen = new Set<string>();

  rows.slice(1).forEach((cells, index) => {
    const line = index + 2;
    const record: Partial<Record<(typeof CSV_HEADERS)[number], string>> = {};
    mapping.forEach((field, column) => {
      if (!field) return;
      record[field] = (cells[column] ?? '').trim();
    });

    const term = record.term ?? '';
    const meaningVi = record.meaning_vi ?? '';
    if (!term || !meaningVi) {
      errors.push(`Dòng ${line}: thiếu từ hoặc nghĩa tiếng Việt.`);
      return;
    }
    const key = `${record.track === 'ielts' ? 'ielts' : defaults.track}:${normalizeTerm(term)}`;
    if (seen.has(key)) {
      errors.push(`Dòng ${line}: "${term}" bị trùng trong file.`);
      return;
    }
    seen.add(key);

    const levelValue = Number(record.level);
    inputs.push({
      term,
      meaningVi,
      ipa: record.ipa ?? null,
      partOfSpeech: record.part_of_speech ?? null,
      definitionEn: record.definition_en ?? null,
      exampleEn: record.example_en ?? null,
      exampleVi: record.example_vi ?? null,
      synonyms: splitList(record.synonyms),
      antonyms: splitList(record.antonyms),
      collocations: splitList(record.collocations),
      wordFamily: splitList(record.word_family),
      topic: record.topic ?? null,
      track: asTrack(record.track, defaults.track),
      level: clampLevel(Number.isFinite(levelValue) ? levelValue : defaults.level, defaults.level),
      source: 'import',
      note: record.note ?? null,
    });
  });

  return { inputs, errors };
}

export async function importCsvWords(
  db: SQLiteDatabase,
  text: string,
  defaults: { track: Track; level: Level },
): Promise<ImportSummary> {
  const { inputs, errors } = parseCsvWords(text, defaults);
  if (inputs.length === 0) return { added: 0, skipped: 0, errors };

  const placeholders = WORD_COLUMNS.map(() => '?').join(', ');
  let added = 0;
  let skipped = 0;
  const timestamp = nowIso();

  await db.withTransactionAsync(async () => {
    for (const input of inputs) {
      const existing = await db.getFirstAsync<{ id: string }>(
        'SELECT id FROM words WHERE normalized_term = ? AND track = ?;',
        [normalizeTerm(input.term), input.track ?? 'general'],
      );
      if (existing) {
        skipped += 1;
        continue;
      }
      const word: Word = {
        id: newId(),
        term: input.term.trim(),
        normalizedTerm: normalizeTerm(input.term),
        ipa: input.ipa ?? null,
        partOfSpeech: input.partOfSpeech ?? null,
        meaningVi: input.meaningVi.trim(),
        definitionEn: input.definitionEn ?? null,
        exampleEn: input.exampleEn ?? null,
        exampleVi: input.exampleVi ?? null,
        synonyms: input.synonyms ?? [],
        antonyms: input.antonyms ?? [],
        collocations: input.collocations ?? [],
        wordFamily: input.wordFamily ?? [],
        topic: input.topic ?? null,
        track: input.track ?? 'general',
        level: input.level ?? 2,
        source: 'import',
        aiGenerated: false,
        confirmed: true,
        note: input.note ?? null,
        audioUrl: null,
        isFavorite: false,
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
      try {
        await db.runAsync(
          `INSERT INTO words (${WORD_COLUMNS.join(', ')}) VALUES (${placeholders});`,
          wordInsertValues(word),
        );
        added += 1;
      } catch (error) {
        errors.push(
          `Không thêm được "${word.term}": ${error instanceof Error ? error.message : 'lỗi không rõ'}`,
        );
      }
    }
  });

  return { added, skipped, errors };
}

export async function exportCsvFile(db: SQLiteDatabase): Promise<ExportedFile> {
  const words = await getAllWords(db);
  const directory = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
  if (!directory) throw new Error('Thiết bị không có thư mục tạm để ghi file.');
  const fileName = `vocabmaster-words-${dateKey()}.csv`;
  const uri = `${directory}${fileName}`;
  await FileSystem.writeAsStringAsync(uri, wordsToCsv(words), {
    encoding: FileSystem.EncodingType.UTF8,
  });
  const shared = await Sharing.isAvailableAsync();
  if (shared) {
    await Sharing.shareAsync(uri, {
      mimeType: 'text/csv',
      dialogTitle: 'Xuất danh sách từ vựng',
      UTI: 'public.comma-separated-values-text',
    });
  }
  return { uri, fileName, shared };
}

import * as SQLite from 'expo-sqlite';

import { SEED_WORDS } from '../data/seed';
import { nowIso, newId } from '../lib/ids';
import { normalizeTerm } from '../lib/text';
import { MIGRATIONS, WORD_COLUMNS, wordInsertValues } from './schema';
import type { Word } from '../types';

const DATABASE_NAME = 'vocabmaster.db';
const SEED_FLAG_KEY = 'seed_version';

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Single shared connection. Opening twice would give two WAL connections and
 * make "database is locked" errors much more likely.
 */
export function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = open();
  }
  return databasePromise;
}

async function open(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await migrate(db);
  return db;
}

/**
 * Apply pending migrations. Each migration runs in a transaction: if one
 * statement fails, the transaction rolls back and the app keeps the previous
 * schema instead of ending up half-migrated.
 */
export async function migrate(db: SQLite.SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
  let currentVersion = row?.user_version ?? 0;

  for (const migration of MIGRATIONS) {
    if (migration.version <= currentVersion) continue;
    try {
      await db.withTransactionAsync(async () => {
        for (const statement of migration.statements) {
          await db.execAsync(statement);
        }
      });
      await db.execAsync(`PRAGMA user_version = ${migration.version};`);
      currentVersion = migration.version;
    } catch (error) {
      console.error(`Migration ${migration.version} failed; database left untouched.`, error);
      throw new Error(
        `Không thể nâng cấp cơ sở dữ liệu lên phiên bản ${migration.version}. Dữ liệu cũ được giữ nguyên.`,
      );
    }
  }

  return currentVersion;
}

export function buildSeedWord(
  input: Omit<Word, 'id' | 'normalizedTerm' | 'createdAt' | 'updatedAt'> ,
  createdAt: string,
): Word {
  return {
    ...input,
    id: newId(),
    normalizedTerm: normalizeTerm(input.term),
    createdAt,
    updatedAt: createdAt,
  };
}

/**
 * Insert the bundled starter vocabulary the first time the app runs (or when
 * the bundled seed version changes). Existing user words are never modified.
 */
export async function seedDatabase(db: SQLite.SQLiteDatabase): Promise<number> {
  const flag = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_settings WHERE key = ?;',
    [SEED_FLAG_KEY],
  );
  const seedVersion = '1';
  if (flag?.value === seedVersion) return 0;

  const createdAt = nowIso();
  const placeholders = WORD_COLUMNS.map(() => '?').join(', ');
  const sql = `INSERT OR IGNORE INTO words (${WORD_COLUMNS.join(', ')}) VALUES (${placeholders});`;

  let inserted = 0;
  await db.withTransactionAsync(async () => {
    for (const seed of SEED_WORDS) {
      const word = buildSeedWord(
        {
          ...seed,
          source: 'seed',
          aiGenerated: false,
          confirmed: true,
          isFavorite: false,
          audioUrl: null,
          learningState: 'new',
          dueAt: null,
          stability: 0,
          difficulty: 0,
          reps: 0,
          lapses: 0,
          lastReviewedAt: null,
          note: null,
          ipa: seed.ipa ?? null,
          partOfSpeech: seed.partOfSpeech ?? null,
          definitionEn: seed.definitionEn ?? null,
          exampleEn: seed.exampleEn ?? null,
          exampleVi: seed.exampleVi ?? null,
          synonyms: seed.synonyms ?? [],
          antonyms: seed.antonyms ?? [],
          collocations: seed.collocations ?? [],
          wordFamily: seed.wordFamily ?? [],
          topic: seed.topic ?? null,
        },
        createdAt,
      );
      const values = wordInsertValues(word);
      const result = await db.runAsync(sql, values);
      if (result.changes > 0) inserted += 1;
    }
    await db.runAsync(
      `INSERT INTO app_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
      [SEED_FLAG_KEY, seedVersion],
    );
  });

  return inserted;
}

/** Only for the destructive "reset all data" flow in Settings. */
export async function resetDatabase(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.execAsync('DELETE FROM reviews;');
    await db.execAsync('DELETE FROM daily_activity;');
    await db.execAsync('DELETE FROM words;');
    await db.execAsync('DELETE FROM app_settings;');
  });
  await seedDatabase(db);
}

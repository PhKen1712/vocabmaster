import type { SQLiteDatabase } from 'expo-sqlite';

import type { DictCache } from '../dict/types';

/**
 * On-device cache for dictionary answers.
 *
 * A lookup is stored as the normalized `SourceResult`, so a cached word keeps
 * working offline and costs no request. `fetchedAt` is an epoch millisecond
 * value; the lookup layer decides whether an entry is still fresh.
 */
export function createSqliteDictCache(db: SQLiteDatabase): DictCache {
  return {
    async get(key) {
      try {
        const row = await db.getFirstAsync<{ value: string; fetched_at: number }>(
          'SELECT value, fetched_at FROM dictionary_cache WHERE key = ?;',
          [key],
        );
        if (!row) return null;
        return { value: JSON.parse(row.value) as unknown, fetchedAt: row.fetched_at };
      } catch {
        // A corrupt cache row must never break a lookup: treat it as a miss.
        return null;
      }
    },

    async set(key, value, fetchedAt) {
      try {
        await db.runAsync(
          `INSERT INTO dictionary_cache (key, value, fetched_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at;`,
          [key, JSON.stringify(value), fetchedAt],
        );
      } catch {
        // Cache writes are best effort; the word was already resolved.
      }
    },
  };
}

/** Drop entries older than `maxAgeMs`. Called on app start, never on the UI thread. */
export async function pruneDictCache(db: SQLiteDatabase, maxAgeMs: number): Promise<number> {
  try {
    const cutoff = Date.now() - maxAgeMs;
    const result = await db.runAsync('DELETE FROM dictionary_cache WHERE fetched_at < ?;', [
      cutoff,
    ]);
    return result.changes ?? 0;
  } catch {
    return 0;
  }
}

export function createMemoryDictCache(): DictCache {
  const store = new Map<string, { value: unknown; fetchedAt: number }>();
  return {
    async get(key) {
      return store.get(key) ?? null;
    },
    async set(key, value, fetchedAt) {
      store.set(key, { value, fetchedAt });
    },
  };
}

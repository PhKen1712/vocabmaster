import type { SQLiteDatabase } from 'expo-sqlite';

import { createMemoryDictCache, createSqliteDictCache, pruneDictCache } from '../dictCache';
import type { SourceResult } from '../../dict/types';

function fakeDb() {
  const rows = new Map<string, { value: string; fetched_at: number }>();
  const db = {
    async getFirstAsync(sql: string, params?: unknown[]) {
      if (!sql.includes('dictionary_cache')) return null;
      return rows.get(String(params?.[0])) ?? null;
    },
    async runAsync(sql: string, params?: unknown[]) {
      if (sql.startsWith('DELETE')) {
        const cutoff = Number(params?.[0] ?? 0);
        let changes = 0;
        for (const [key, row] of rows) {
          if (row.fetched_at < cutoff) {
            rows.delete(key);
            changes += 1;
          }
        }
        return { changes, lastInsertRowId: 0 };
      }
      rows.set(String(params?.[0]), {
        value: String(params?.[1]),
        fetched_at: Number(params?.[2]),
      });
      return { changes: 1, lastInsertRowId: 0 };
    },
  } as unknown as SQLiteDatabase;
  return { db, rows };
}

const sample: SourceResult = {
  source: 'minhqnd',
  found: true,
  ipa: '/ˈkrɪ.mə.nᵊl/',
  audioUrl: 'https://dict.minhqnd.com/api/v1/tts?word=criminal&lang=en',
  partOfSpeech: 'adjective',
  meaningsVi: ['Có tội, phạm tội, tội ác.'],
  definitionsEn: [],
  exampleEn: null,
  synonyms: [],
  antonyms: [],
};

describe('createSqliteDictCache', () => {
  it('round-trips a lookup and its timestamp', async () => {
    const { db } = fakeDb();
    const cache = createSqliteDictCache(db);

    await cache.set('minhqnd:en:criminal', sample, 1_700_000_000_000);
    await expect(cache.get('minhqnd:en:criminal')).resolves.toEqual({
      value: sample,
      fetchedAt: 1_700_000_000_000,
    });
  });

  it('overwrites the same key instead of duplicating it', async () => {
    const { db, rows } = fakeDb();
    const cache = createSqliteDictCache(db);

    await cache.set('minhqnd:en:criminal', sample, 1);
    await cache.set('minhqnd:en:criminal', { ...sample, ipa: '/new/' }, 2);

    expect(rows.size).toBe(1);
    const hit = await cache.get('minhqnd:en:criminal');
    expect((hit?.value as SourceResult).ipa).toBe('/new/');
  });

  it('treats a corrupt row as a miss instead of throwing', async () => {
    const { db, rows } = fakeDb();
    rows.set('minhqnd:en:criminal', { value: 'not json', fetched_at: 1 });
    await expect(createSqliteDictCache(db).get('minhqnd:en:criminal')).resolves.toBeNull();
  });
});

describe('pruneDictCache', () => {
  it('deletes only entries older than the cutoff', async () => {
    const { db, rows } = fakeDb();
    const cache = createSqliteDictCache(db);
    await cache.set('old', sample, Date.now() - 100 * 24 * 60 * 60 * 1000);
    await cache.set('fresh', sample, Date.now());

    const removed = await pruneDictCache(db, 90 * 24 * 60 * 60 * 1000);

    expect(removed).toBe(1);
    await expect(cache.get('old')).resolves.toBeNull();
    await expect(cache.get('fresh')).resolves.not.toBeNull();
    expect(rows.size).toBe(1);
  });
});

describe('createMemoryDictCache', () => {
  it('stores values in memory', async () => {
    const cache = createMemoryDictCache();
    expect(await cache.get('x')).toBeNull();
    await cache.set('x', { hello: 'world' }, 42);
    await expect(cache.get('x')).resolves.toEqual({ value: { hello: 'world' }, fetchedAt: 42 });
  });
});

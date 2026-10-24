import type { SQLiteDatabase } from 'expo-sqlite';

import type { AiProvider, Level, Track } from '../types';
import type { AiSuggestion } from './types';

/**
 * Small on-device cache for AI explanations of pasted terms.
 *
 * Pasting the same list twice (or importing a word that is already being
 * studied) should not spend another Groq request. Only a fully parsed,
 * usable suggestion is cached; failed and empty answers are retried next time.
 * The key includes the provider, model, track and level so changing settings
 * never reuses an answer written under different instructions.
 */

const CACHE_VERSION = 1;

export function explainCacheKey(input: {
  provider: AiProvider;
  model: string;
  track: Track;
  level: Level;
  term: string;
}): string {
  return [
    'explain',
    CACHE_VERSION,
    input.provider,
    input.model.trim().toLowerCase(),
    input.track,
    input.level,
    input.term.trim().toLowerCase().replace(/\s+/g, ' '),
  ].join('|');
}

function asSuggestion(value: unknown): AiSuggestion | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.term !== 'string' || !record.term.trim()) return null;
  if (typeof record.meaningVi !== 'string' || !record.meaningVi.trim()) return null;
  const list = (key: string): string[] =>
    Array.isArray(record[key])
      ? (record[key] as unknown[]).filter((item): item is string => typeof item === 'string')
      : [];
  return {
    term: record.term.trim(),
    meaningVi: record.meaningVi.trim(),
    ipa: typeof record.ipa === 'string' ? record.ipa : null,
    partOfSpeech: typeof record.partOfSpeech === 'string' ? record.partOfSpeech : null,
    definitionEn: typeof record.definitionEn === 'string' ? record.definitionEn : null,
    exampleEn: typeof record.exampleEn === 'string' ? record.exampleEn : null,
    exampleVi: typeof record.exampleVi === 'string' ? record.exampleVi : null,
    synonyms: list('synonyms'),
    antonyms: list('antonyms'),
    collocations: list('collocations'),
    wordFamily: list('wordFamily'),
    topic: typeof record.topic === 'string' ? record.topic : null,
    level:
      typeof record.level === 'number' && record.level >= 0 && record.level <= 6
        ? (Math.round(record.level) as Level)
        : undefined,
    source: 'ai',
    aiGenerated: true,
    confirmed: false,
    rationale: typeof record.rationale === 'string' ? record.rationale : null,
  };
}

export async function readExplainCache(
  db: SQLiteDatabase,
  keys: readonly string[],
): Promise<Map<string, AiSuggestion>> {
  const result = new Map<string, AiSuggestion>();
  if (keys.length === 0) return result;
  const placeholders = keys.map(() => '?').join(', ');
  try {
    const rows = await db.getAllAsync<{ key: string; value: string }>(
      `SELECT key, value FROM ai_cache WHERE key IN (${placeholders});`,
      [...keys],
    );
    for (const row of rows) {
      try {
        const suggestion = asSuggestion(JSON.parse(row.value));
        if (suggestion) result.set(row.key, suggestion);
      } catch {
        // A corrupt row is ignored and overwritten by the next successful call.
      }
    }
  } catch {
    // Cache is optional: a missing table or a locked database must never stop
    // the import.
  }
  return result;
}

export async function writeExplainCache(
  db: SQLiteDatabase,
  entries: readonly { key: string; suggestion: AiSuggestion }[],
  fetchedAt = Date.now(),
): Promise<void> {
  if (entries.length === 0) return;
  try {
    await db.withTransactionAsync(async () => {
      for (const entry of entries) {
        await db.runAsync(
          `INSERT INTO ai_cache (key, value, fetched_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at;`,
          [entry.key, JSON.stringify(entry.suggestion), fetchedAt],
        );
      }
    });
  } catch {
    // Same rule as reading: losing a cache write must not fail the import.
  }
}

export async function pruneAiCache(
  db: SQLiteDatabase,
  maxAgeMs = 180 * 24 * 60 * 60 * 1000,
): Promise<void> {
  try {
    await db.runAsync('DELETE FROM ai_cache WHERE fetched_at < ?;', [Date.now() - maxAgeMs]);
  } catch {
    // Best effort only.
  }
}

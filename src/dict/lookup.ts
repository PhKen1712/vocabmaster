/**
 * Dictionary lookup pipeline.
 *
 * One word = at most two HTTP requests (minhqnd + Wiktionary), run in parallel
 * behind a small concurrency limiter. Rules that matter:
 *
 * - cache first: a word looked up before never hits the network again;
 * - timeout is a hard per-request deadline and is NOT retried in a second
 *   round on top of an exhausted attempt budget;
 * - only network/timeout/429/5xx are retried, with exponential backoff and
 *   jitter; a 404 or a broken payload is reported immediately;
 * - one bad word never aborts the batch, and every word reports which fields
 *   are still missing instead of filling them with invented data.
 */

import { jitteredDelay } from '../ai/retry';
import { normalizeTerm } from '../lib/text';
import type { Level, Track, WordField, WordInput } from '../types';
import {
  MINHQND_SOURCE,
  WIKTIONARY_SOURCE,
  type SourceDefinition,
  minhqndUrl,
  wiktionaryUrl,
} from './sources';
import {
  RETRYABLE_DICT_ERRORS,
  type DictCache,
  type DictEntry,
  type DictError,
  type DictErrorCode,
  type DictField,
  type DictSourceName,
  type HttpClient,
  type HttpResult,
  type SourceResult,
} from './types';

export const DEFAULT_TIMEOUT_MS = 8_000;
export const DEFAULT_CONCURRENCY = 3;
export const DEFAULT_ATTEMPTS = 2;
const DEFAULT_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const BASE_RETRY_DELAY_MS = 400;
const MAX_RETRY_AFTER_MS = 3_000;

export class DictRequestError extends Error {
  readonly dictError: DictError;
  constructor(dictError: DictError) {
    super(dictError.message);
    this.name = 'DictRequestError';
    this.dictError = dictError;
  }
}

/** Fetch/HTTP wrapper with a hard deadline. Injectable so tests stay offline. */
export function createHttpClient(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): HttpClient {
  return async (url, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    init?.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const response = await fetchImpl(url, { signal: controller.signal });
      const body = await response.text();
      const headers: Record<string, string> = {};
      response.headers?.forEach?.((value, key) => {
        headers[key.toLowerCase()] = value;
      });
      return { status: response.status, body, headers };
    } catch (error) {
      const aborted = controller.signal.aborted || init?.signal?.aborted;
      if (aborted && !init?.signal?.aborted) {
        throw new DictRequestError({
          code: 'timeout',
          message: `Hết ${Math.round(timeoutMs / 1000)} giây chờ từ điển.`,
        });
      }
      if (aborted) throw new DictRequestError({ code: 'network', message: 'Đã huỷ tra từ điển.' });
      throw new DictRequestError({
        code: 'network',
        message: error instanceof Error ? error.message : 'Không kết nối được từ điển.',
      });
    } finally {
      clearTimeout(timer);
      init?.signal?.removeEventListener('abort', onAbort);
    }
  };
}

/** Runs at most `limit` tasks at once; the rest wait in FIFO order. */
export class Limiter {
  private active = 0;
  private readonly queue: (() => void)[] = [];
  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.queue.shift()?.();
    }
  }
}

export interface LookupOptions {
  client?: HttpClient;
  cache?: DictCache;
  signal?: AbortSignal;
  concurrency?: number;
  attempts?: number;
  cacheTtlMs?: number;
  /** Called as each word settles, so the UI can paint results one by one. */
  onEntry?: (entry: DictEntry, index: number, total: number) => void;
  /**
   * Optional Vietnamese fallback for words the dictionaries answered without a
   * Vietnamese meaning. The result is labelled `gemini` everywhere it is shown.
   */
  aiTranslate?: (term: string) => Promise<{ meaningVi: string } | null>;
  aiTranslateLimit?: number;
  /** Injectable clock, for cache tests. */
  now?: () => number;
}

const SOURCES: SourceDefinition[] = [MINHQND_SOURCE, WIKTIONARY_SOURCE];

export const DICTIONARY_URLS = { minhqnd: minhqndUrl, wiktionary: wiktionaryUrl };

function classifyStatus(status: number, headers: Record<string, string>): DictError {
  if (status === 429) {
    const retryAfter = Number(headers['retry-after']);
    return {
      code: 'rate_limited',
      message: 'Từ điển giới hạn số lần gọi (429).',
      status,
      ...(Number.isFinite(retryAfter) ? { retryAfterMs: retryAfter * 1000 } : {}),
    };
  }
  if (status >= 500) {
    return { code: 'server', message: `Từ điển lỗi ${status}.`, status };
  }
  return { code: 'http', message: `Từ điển trả về ${status}.`, status };
}

function retryAfterOf(error: unknown): number | null {
  if (error instanceof DictRequestError) {
    const value = error.dictError.retryAfterMs;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function emptySource(source: DictSourceName): SourceResult {
  return {
    source,
    found: false,
    ipa: null,
    audioUrl: null,
    partOfSpeech: null,
    meaningsVi: [],
    definitionsEn: [],
    exampleEn: null,
    synonyms: [],
    antonyms: [],
  };
}

async function requestOnce(
  source: SourceDefinition,
  term: string,
  client: HttpClient,
  signal?: AbortSignal,
): Promise<SourceResult> {
  if (signal?.aborted) {
    throw new DictRequestError({ code: 'network', message: 'Đã huỷ tra từ điển.' });
  }
  const response: HttpResult = await client(source.url(term), { signal });

  if (source.notFoundStatuses?.includes(response.status)) {
    return { ...emptySource(source.name), found: false };
  }
  if (response.status < 200 || response.status >= 300) {
    throw new DictRequestError(classifyStatus(response.status, response.headers ?? {}));
  }

  const parsed = source.parse(response.body, term);
  if (parsed.error?.code === 'parse') {
    throw new DictRequestError(parsed.error);
  }
  return parsed;
}

async function lookupSource(
  source: SourceDefinition,
  term: string,
  context: {
    client: HttpClient;
    cache?: DictCache;
    limiter: Limiter;
    signal?: AbortSignal;
    attempts: number;
    ttlMs: number;
    now: () => number;
  },
): Promise<SourceResult> {
  const key = `${source.name}:en:${normalizeTerm(term)}`;

  if (context.cache) {
    const hit = await context.cache.get(key);
    if (hit && context.now() - hit.fetchedAt < context.ttlMs) {
      const value = hit.value as SourceResult;
      if (value && typeof value === 'object') {
        return { ...value, cached: true };
      }
    }
  }

  let lastError: DictError | null = null;

  for (let attempt = 1; attempt <= context.attempts; attempt += 1) {
    try {
      const result = await context.limiter.run(() =>
        requestOnce(source, term, context.client, context.signal),
      );
      // Only successful answers are cached: a word the dictionary did not know
      // yesterday may be there tomorrow, and a cached 404 would hide that.
      if (result.found && context.cache) {
        await context.cache.set(key, result, context.now());
      }
      return result;
    } catch (error) {
      const dictError =
        error instanceof DictRequestError
          ? error.dictError
          : { code: 'network' as DictErrorCode, message: 'Lỗi không xác định.' };
      lastError = dictError;

      const canRetry = RETRYABLE_DICT_ERRORS.has(dictError.code);
      if (!canRetry || attempt >= context.attempts || context.signal?.aborted) break;

      const requested = retryAfterOf(error);
      const delay =
        requested !== null
          ? Math.min(requested, MAX_RETRY_AFTER_MS)
          : jitteredDelay(attempt, { baseDelayMs: BASE_RETRY_DELAY_MS, maxDelayMs: 2_000 });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return { ...emptySource(source.name), error: lastError ?? { code: 'network', message: 'Lỗi.' } };
}

function pickError(results: SourceResult[]): DictError {
  const priority: DictErrorCode[] = [
    'rate_limited',
    'timeout',
    'network',
    'server',
    'http',
    'parse',
  ];
  const errors = results.map((item) => item.error).filter((item): item is DictError => Boolean(item));
  for (const code of priority) {
    const match = errors.find((error) => error.code === code);
    if (match) return match;
  }
  return errors[0] ?? { code: 'network', message: 'Không tra được từ này.' };
}

function union(values: string[][], exclude: string, limit = 6): string[] {
  const seen = new Set<string>([exclude.trim().toLowerCase()]);
  const result: string[] = [];
  for (const list of values) {
    for (const value of list) {
      const clean = value.trim();
      const key = clean.toLowerCase();
      if (!clean || seen.has(key)) continue;
      seen.add(key);
      result.push(clean);
      if (result.length >= limit) return result;
    }
  }
  return result;
}

export function mergeResults(term: string, results: SourceResult[]): Omit<DictEntry, 'attempts' | 'elapsedMs'> {
  const found = results.filter((item) => item.found);
  const vi = found.find((item) => item.source === 'minhqnd');
  const en = found.find((item) => item.source === 'wiktionary');

  const meaningsVi = vi?.meaningsVi ?? [];
  const entry: Omit<DictEntry, 'attempts' | 'elapsedMs'> = {
    term,
    normalized: normalizeTerm(term),
    status: found.length > 0 ? 'found' : results.some((item) => item.error) ? 'failed' : 'notFound',
    ipa: vi?.ipa ?? en?.ipa ?? null,
    audioUrl: en?.audioUrl ?? vi?.audioUrl ?? null,
    partOfSpeech: vi?.partOfSpeech ?? en?.partOfSpeech ?? null,
    meaningVi: meaningsVi[0] ?? null,
    otherMeaningsVi: meaningsVi.slice(1, 4),
    definitionEn: en?.definitionsEn[0] ?? vi?.definitionsEn[0] ?? null,
    exampleEn: en?.exampleEn ?? vi?.exampleEn ?? null,
    synonyms: union([en?.synonyms ?? [], vi?.synonyms ?? []], term),
    antonyms: union([en?.antonyms ?? [], vi?.antonyms ?? []], term),
    level: null,
    levelSource: null,
    sources: found.map((item) => item.source),
    aiFilled: [],
    missing: [],
    cached: results.some((item) => item.cached === true),
  };

  if (entry.status === 'failed') {
    entry.error = pickError(results);
  }

  entry.missing = computeMissing(entry);
  return entry;
}

export function computeMissing(entry: {
  ipa: string | null;
  audioUrl: string | null;
  partOfSpeech: string | null;
  meaningVi: string | null;
  definitionEn: string | null;
  exampleEn: string | null;
  synonyms: string[];
}): DictField[] {
  const missing: DictField[] = [];
  if (!entry.ipa) missing.push('ipa');
  if (!entry.audioUrl) missing.push('audio');
  if (!entry.partOfSpeech) missing.push('partOfSpeech');
  if (!entry.meaningVi) missing.push('meaningVi');
  if (!entry.definitionEn) missing.push('definitionEn');
  if (!entry.exampleEn) missing.push('exampleEn');
  if (entry.synonyms.length === 0) missing.push('synonyms');
  return missing;
}

/** Look up one word through every source, without touching the batch queue. */
export async function lookupWord(term: string, options: LookupOptions = {}): Promise<DictEntry> {
  const [entry] = await lookupWords([term], options);
  return entry ?? {
    ...mergeResults(term, []),
    status: 'failed',
    error: { code: 'network', message: 'Không tra được từ này.' },
    attempts: 0,
    elapsedMs: 0,
  };
}

export async function lookupWords(
  terms: string[],
  options: LookupOptions = {},
): Promise<DictEntry[]> {
  const client = options.client ?? createHttpClient(fetch, DEFAULT_TIMEOUT_MS);
  const limiter = new Limiter(Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY));
  const context = {
    client,
    cache: options.cache,
    limiter,
    signal: options.signal,
    attempts: Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS),
    ttlMs: options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
    now: options.now ?? Date.now,
  };

  const started = context.now();
  const entries: DictEntry[] = new Array(terms.length);

  await Promise.all(
    terms.map(async (term, index) => {
      const wordStarted = context.now();
      let merged: Omit<DictEntry, 'attempts' | 'elapsedMs'>;
      try {
        const results = await Promise.all(
          SOURCES.map((source) => lookupSource(source, term, context)),
        );
        merged = mergeResults(term, results);
      } catch {
        merged = { ...mergeResults(term, []), status: 'failed' };
        merged.error = { code: 'network', message: 'Không tra được từ này.' };
      }

      const entry: DictEntry = {
        ...merged,
        attempts: context.attempts,
        elapsedMs: Math.max(0, context.now() - wordStarted),
      };
      entries[index] = entry;
      options.onEntry?.(entry, index, terms.length);
    }),
  );

  // Gemini fills the Vietnamese meaning only where both dictionaries had none.
  const aiCandidates = (options.aiTranslateLimit ?? 0) > 0 && options.aiTranslate
    ? entries.filter((entry) => entry.status === 'found' && !entry.meaningVi)
    : [];

  for (const entry of aiCandidates.slice(0, options.aiTranslateLimit ?? 0)) {
    try {
      const filled = await options.aiTranslate?.(entry.term);
      if (filled?.meaningVi?.trim()) {
        entry.meaningVi = filled.meaningVi.trim();
        entry.aiFilled = [...new Set<DictField>([...entry.aiFilled, 'meaningVi'])];
        entry.sources = [...new Set<DictSourceName>([...entry.sources, 'gemini'])];
        entry.missing = computeMissing(entry);
      }
    } catch {
      // A failed translation must not lose the dictionary data we already have.
    }
  }

  return entries.map((entry, index) => entries[index] ?? {
    ...mergeResults(terms[index] ?? '', []),
    status: 'failed',
    attempts: 0,
    elapsedMs: Math.max(0, context.now() - started),
  });
}

export interface EntryDefaults {
  track: Track;
  level: Level;
  topic?: string | null;
  note?: string | null;
}

/** Map a resolved entry to the existing word model. Returns null if unusable. */
export function entryToWordInput(entry: DictEntry, defaults: EntryDefaults): WordInput | null {
  if (entry.status !== 'found' || !entry.meaningVi) return null;
  const missing: WordField[] = entry.missing;
  return {
    term: entry.term,
    ipa: entry.ipa,
    partOfSpeech: entry.partOfSpeech,
    meaningVi: entry.meaningVi,
    definitionEn: entry.definitionEn,
    exampleEn: entry.exampleEn,
    exampleVi: null,
    synonyms: entry.synonyms,
    antonyms: entry.antonyms,
    collocations: [],
    wordFamily: [],
    topic: defaults.topic?.trim() || null,
    track: defaults.track,
    // The level the app worked out for this word wins; `defaults.level` is only
    // the fallback when nobody could estimate it (and the card says so).
    level: entry.level ?? defaults.level,
    source: 'dictionary',
    aiGenerated: entry.aiFilled.length > 0,
    confirmed: true,
    note: defaults.note ?? null,
    audioUrl: entry.audioUrl,
    dictSource: entry.sources.join('+') || null,
    missingFields: missing,
  };
}

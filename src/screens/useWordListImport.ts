import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SQLiteDatabase } from 'expo-sqlite';

import { generateVocabulary } from '../ai';
import { explainCacheKey, readExplainCache, writeExplainCache } from '../ai/cache';
import { describeAiError } from '../ai/errors';
import type { AiSuggestion } from '../ai/types';
import { packLevel } from '../data/packs';
import { normalizeTerm } from '../lib/text';
import type { Level, Track } from '../types';
import { parseWordList } from '../wordlist/parse';
import { entryFromSuggestion, failedEntry, type ListEntry } from '../wordlist/types';

/**
 * State machine for "paste a list of words / phrases".
 *
 * Groq is the only source of vocabulary data. There is intentionally no
 * dictionary lookup and no dictionary fallback: a phrase such as
 * `take into account` is explained as one unit instead of being rejected for
 * not being a single word.
 *
 * The list is answered in small batches (10 items) because Groq's free tier has
 * a tokens-per-minute budget and a single 50-word answer is easily truncated.
 * Results land progressively, a failed batch never hides the batches that
 * already succeeded, and retrying only re-sends the failed items. Successful
 * answers are cached on device so pasting the same list again costs nothing.
 */

const BATCH_SIZE = 10;
const EXPLAIN_TIMEOUT_MS = 45_000;

export interface WordListImport {
  text: string;
  setText: (value: string) => void;
  parsed: ReturnType<typeof parseWordList>;
  entries: ListEntry[];
  selected: Set<string>;
  toggle: (normalized: string) => void;
  selectAll: (include: boolean) => void;
  running: boolean;
  elapsed: number;
  done: number;
  total: number;
  error: string | null;
  /** Informational line: cache hits, partial success, etc. */
  note: string | null;
  /** Ready rows with a Vietnamese meaning but no estimated level. */
  unknownLevels: number;
  /** Failed rows still waiting for a retry. */
  failedCount: number;
  lookUp: () => void;
  retryFailed: () => void;
  cancel: () => void;
  clear: () => void;
}

export interface UseWordListImportOptions {
  db: SQLiteDatabase | null;
  track: Track;
  level: Level;
  topic: string;
  model: string;
}

function matchKey(term: string): string {
  // Groq sometimes prefixes a verb with "to " even when the learner did not.
  // Accept that spelling for matching, but keep the learner's own term when
  // saving so the bank does not silently acquire a duplicate variant.
  return normalizeTerm(term).replace(/^to\s+/, '');
}

function levelOf(suggestion: AiSuggestion | null, term: string, track: Track): Level | null {
  if (suggestion?.level !== undefined && suggestion.level !== null) return suggestion.level;
  return packLevel(term, track);
}

function readyEntry(
  term: string,
  suggestion: AiSuggestion,
  track: Track,
  cached: boolean,
): ListEntry {
  return entryFromSuggestion(term, suggestion, {
    level: levelOf(suggestion, term, track),
    levelSource: suggestion.level !== undefined ? 'ai' : packLevel(term, track) !== null ? 'pack' : null,
    cached,
  });
}

function mergeEntries(
  order: readonly string[],
  resolved: ReadonlyMap<string, ListEntry>,
  kept: readonly ListEntry[],
): ListEntry[] {
  const byKey = new Map<string, ListEntry>();
  for (const entry of kept) byKey.set(entry.normalized, entry);
  for (const entry of resolved.values()) byKey.set(entry.normalized, entry);

  const result: ListEntry[] = [];
  const used = new Set<string>();
  for (const term of order) {
    const key = normalizeTerm(term);
    const entry = byKey.get(key);
    if (entry && !used.has(key)) {
      result.push(entry);
      used.add(key);
    }
  }
  // A retry call only receives the failed terms; keep every other row that was
  // already on screen so the preview does not lose successful results.
  for (const entry of kept) {
    if (!used.has(entry.normalized)) {
      result.push(entry);
      used.add(entry.normalized);
    }
  }
  return result;
}

export function useWordListImport(options: UseWordListImportOptions): WordListImport {
  const { db, track, level, topic, model } = options;

  const [text, setText] = useState('');
  const [entries, setEntries] = useState<ListEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);

  const parsed = useMemo(() => parseWordList(text), [text]);

  useEffect(() => {
    if (!running) {
      setElapsed(0);
      return;
    }
    const startedAt = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    runningRef.current = false;
    setRunning(false);
  }, []);

  const run = useCallback(
    async (terms: string[], kept: ListEntry[] = []) => {
      if (!db || runningRef.current || terms.length === 0) return;
      runningRef.current = true;
      const controller = new AbortController();
      abortRef.current = controller;

      setRunning(true);
      setError(null);
      setNote(null);
      setDone(0);
      setTotal(terms.length);
      setEntries(mergeEntries(terms, new Map(), kept));

      const resolved = new Map<string, ListEntry>();
      const keys = new Map<string, string>();
      for (const term of terms) {
        keys.set(
          term,
          explainCacheKey({ provider: 'groq', model, track, level, term }),
        );
      }

      // Cache first: a repeated paste should finish without a network call.
      let cacheHits = 0;
      try {
        const cached = await readExplainCache(db, [...keys.values()]);
        for (const term of terms) {
          const key = keys.get(term);
          const suggestion = key ? cached.get(key) : undefined;
          if (!suggestion) continue;
          resolved.set(normalizeTerm(term), readyEntry(term, suggestion, track, true));
          cacheHits += 1;
        }
      } catch {
        // Ignore cache failures and continue with the network.
      }
      if (resolved.size > 0) {
        setDone(resolved.size);
        setEntries(mergeEntries(terms, resolved, kept));
      }

      const pending = terms.filter((term) => !resolved.has(normalizeTerm(term)));
      let stopped: string | null = null;
      const toCache: { key: string; suggestion: AiSuggestion }[] = [];

      for (let start = 0; start < pending.length; start += BATCH_SIZE) {
        if (controller.signal.aborted) break;
        const batch = pending.slice(start, start + BATCH_SIZE);
        setNote(
          `Groq đang viết nghĩa cho ${Math.min(start + batch.length, pending.length)}/${pending.length} từ…`,
        );

        try {
          const result = await generateVocabulary(
            {
              track,
              level,
              topic: topic.trim() || null,
              count: batch.length,
              explainTerms: batch,
              avoidTerms: [],
              weakTerms: [],
            },
            {
              provider: 'groq',
              model,
              signal: controller.signal,
              timeoutMs: EXPLAIN_TIMEOUT_MS,
              attempts: 2,
            },
          );

          const byTerm = new Map<string, AiSuggestion>();
          const byBare = new Map<string, AiSuggestion>();
          for (const suggestion of result.suggestions) {
            byTerm.set(normalizeTerm(suggestion.term), suggestion);
            byBare.set(matchKey(suggestion.term), suggestion);
          }

          for (const term of batch) {
            const normalized = normalizeTerm(term);
            const suggestion =
              byTerm.get(normalized) ?? byBare.get(matchKey(term)) ?? null;
            if (suggestion) {
              resolved.set(normalized, readyEntry(term, suggestion, track, false));
              const key = keys.get(term);
              if (key) toCache.push({ key, suggestion });
            } else {
              resolved.set(
                normalized,
                failedEntry(
                  term,
                  'Groq không trả về mục này. Bấm thử lại — các từ đã xong được giữ nguyên.',
                ),
              );
            }
          }

          setDone((value) => Math.min(terms.length, value + batch.length));
          setEntries(mergeEntries(terms, resolved, kept));
        } catch (caught) {
          if (controller.signal.aborted) break;
          const view = describeAiError(caught, 'Groq');
          stopped = view.hint ? `${view.title}. ${view.hint}` : view.body;
          // Do not retry a key/quota problem once per batch: mark the rest as
          // failed with the same honest reason and stop burning requests.
          for (const term of pending.slice(start)) {
            if (resolved.has(normalizeTerm(term))) continue;
            resolved.set(normalizeTerm(term), failedEntry(term, stopped));
          }
          setEntries(mergeEntries(terms, resolved, kept));
          break;
        }
      }

      if (!controller.signal.aborted) {
        if (toCache.length > 0) void writeExplainCache(db, toCache);
        const allReady = [...kept, ...resolved.values()].filter(
          (entry) => entry.status === 'ready',
        );
        setSelected(
          new Set(allReady.filter((entry) => entry.meaningVi).map((entry) => entry.normalized)),
        );
        const ready = [...resolved.values()].filter((entry) => entry.status === 'ready');
        const failed = [...resolved.values()].filter((entry) => entry.status === 'failed');
        if (stopped) {
          setError(`${failed.length} mục chưa xử lý được: ${stopped}`);
        } else if (failed.length > 0) {
          setError(`${failed.length} mục chưa xử lý được. Bấm "Thử lại" cho đúng các mục đó.`);
        }
        const pieces: string[] = [];
        if (cacheHits > 0) pieces.push(`${cacheHits} từ lấy từ bộ nhớ đệm, không tốn lượt gọi`);
        if (ready.length > 0) pieces.push(`${ready.length} từ đã có nghĩa tiếng Việt`);
        if (terms.length > BATCH_SIZE) pieces.push('danh sách dài được chia thành nhiều đợt');
        setNote(pieces.length > 0 ? pieces.join(' · ') : null);
      }

      if (abortRef.current === controller) abortRef.current = null;
      runningRef.current = false;
      setRunning(false);
    },
    [db, track, level, topic, model],
  );

  const lookUp = useCallback(() => {
    void run(parsed.terms);
  }, [run, parsed.terms]);

  const retryFailed = useCallback(() => {
    const failed = entries.filter((entry) => entry.status === 'failed');
    if (failed.length === 0) return;
    const kept = entries.filter((entry) => entry.status !== 'failed');
    void run(failed.map((entry) => entry.term), kept);
  }, [entries, run]);

  const toggle = useCallback((normalized: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(normalized)) next.delete(normalized);
      else next.add(normalized);
      return next;
    });
  }, []);

  const selectAll = useCallback(
    (include: boolean) => {
      if (!include) {
        setSelected(new Set());
        return;
      }
      setSelected(
        new Set(
          entries
            .filter((entry) => entry.status === 'ready' && Boolean(entry.meaningVi))
            .map((entry) => entry.normalized),
        ),
      );
    },
    [entries],
  );

  const clear = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    runningRef.current = false;
    setRunning(false);
    setEntries([]);
    setSelected(new Set());
    setError(null);
    setNote(null);
    setDone(0);
    setTotal(0);
  }, []);

  const unknownLevels = entries.filter(
    (entry) => entry.status === 'ready' && Boolean(entry.meaningVi) && entry.level === null,
  ).length;

  return {
    text,
    setText,
    parsed,
    entries,
    selected,
    toggle,
    selectAll,
    running,
    elapsed,
    done,
    total,
    error,
    note,
    unknownLevels,
    failedCount: entries.filter((entry) => entry.status === 'failed').length,
    lookUp,
    retryFailed,
    cancel,
    clear,
  };
}

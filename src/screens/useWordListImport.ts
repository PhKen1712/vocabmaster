import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SQLiteDatabase } from 'expo-sqlite';

import { generateVocabulary } from '../ai';
import { explainCacheKey, readExplainCache, writeExplainCache } from '../ai/cache';
import { describeAiError } from '../ai/errors';
import type { AiSuggestion } from '../ai/types';
import { packLevel } from '../data/packs';
import { normalizeTerm, uniqueStrings } from '../lib/text';
import type { Level, Track } from '../types';
import { buildSuggestionPools, matchSuggestion } from '../wordlist/match';
import { parseWordList, type ParsedListItem } from '../wordlist/parse';
import { entryFromSuggestion, failedEntry, type ListEntry } from '../wordlist/types';

/**
 * State machine for "paste a list of words / phrases".
 *
 * The list may mix languages: English items go straight to the dictionary path,
 * Vietnamese items are translated to English by Groq first (one item per line,
 * phrases kept whole). Groq is still the only source of vocabulary data. There
 * is intentionally no dictionary lookup and no dictionary fallback: a phrase
 * such as `take into account` is explained as one unit instead of being rejected
 * for not being a single word.
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
  /** Items detected as Vietnamese in the current text. */
  vietnameseCount: number;
  /** Ready rows that Groq translated from Vietnamese. */
  translatedCount: number;
  /** Switch a translated row to another English option Groq offered. */
  chooseOption: (normalized: string, term: string) => void;
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

/**
 * The level Groq judged wins. Only when it explicitly fell back to the
 * learner's requested level do we try the bundled pack, and only then use the
 * requested level as an honest last resort.
 */
function levelOf(
  suggestion: AiSuggestion | null,
  term: string,
  track: Track,
): { level: Level | null; source: ListEntry['levelSource'] } {
  const judged =
    suggestion?.level != null && suggestion.levelSource !== 'requested'
      ? suggestion.level
      : null;
  if (judged !== null) return { level: judged, source: 'ai' };
  const packed = packLevel(term, track);
  if (packed !== null) return { level: packed, source: 'pack' };
  if (suggestion?.level != null) return { level: suggestion.level, source: 'settings' };
  return { level: null, source: null };
}

function readyEntry(
  requested: ParsedListItem,
  suggestion: AiSuggestion,
  track: Track,
  cached: boolean,
): ListEntry {
  const translated = requested.language === 'vi';
  // The row that gets saved is always the English term: for a Vietnamese item
  // that is the term Groq chose, never the Vietnamese the learner typed.
  const term = translated ? suggestion.term : requested.value;
  const resolved = levelOf(suggestion, term, track);
  return entryFromSuggestion(term, suggestion, {
    level: resolved.level,
    levelSource: resolved.source,
    cached,
    key: requested.value,
    language: requested.language,
    translation: translated
      ? {
          sourceTerm: requested.value,
          englishOptions: uniqueStrings([term, ...(suggestion.englishOptions ?? [])]).slice(0, 3),
          uncertain: suggestion.uncertain === true,
        }
      : null,
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
    async (items: ParsedListItem[], kept: ListEntry[] = []) => {
      if (!db || runningRef.current || items.length === 0) return;
      runningRef.current = true;
      const controller = new AbortController();
      abortRef.current = controller;

      const terms = items.map((item) => item.value);
      setRunning(true);
      setError(null);
      setNote(null);
      setDone(0);
      setTotal(items.length);
      setEntries(mergeEntries(terms, new Map(), kept));

      const resolved = new Map<string, ListEntry>();
      const keys = new Map<string, string>();
      for (const item of items) {
        keys.set(
          item.value,
          explainCacheKey({ provider: 'groq', model, track, level, term: item.value }),
        );
      }

      // Cache first: a repeated paste should finish without a network call.
      let cacheHits = 0;
      try {
        const cached = await readExplainCache(db, [...keys.values()]);
        for (const item of items) {
          const key = keys.get(item.value);
          const suggestion = key ? cached.get(key) : undefined;
          if (!suggestion) continue;
          resolved.set(normalizeTerm(item.value), readyEntry(item, suggestion, track, true));
          cacheHits += 1;
        }
      } catch {
        // Ignore cache failures and continue with the network.
      }
      if (resolved.size > 0) {
        setDone(resolved.size);
        setEntries(mergeEntries(terms, resolved, kept));
      }

      const pending = items.filter((item) => !resolved.has(normalizeTerm(item.value)));
      let stopped: string | null = null;
      let processed = resolved.size;
      const toCache: { key: string; suggestion: AiSuggestion }[] = [];

      // Vietnamese first, so the English terms appear early; a problem in one
      // language never blocks the other.
      for (const language of ['vi', 'en'] as const) {
        const group = pending.filter((item) => item.language === language);
        for (let start = 0; start < group.length; start += BATCH_SIZE) {
          if (controller.signal.aborted || stopped) break;
          const batch = group.slice(start, start + BATCH_SIZE);
          const translating = language === 'vi';
          setNote(
            translating
              ? `Groq đang dịch ${Math.min(processed + batch.length, pending.length)}/${pending.length} mục tiếng Việt sang tiếng Anh…`
              : `Groq đang viết nghĩa cho ${Math.min(processed + batch.length, pending.length)}/${pending.length} từ…`,
          );

          try {
            const result = await generateVocabulary(
              {
                track,
                level,
                topic: topic.trim() || null,
                count: batch.length,
                explainTerms: batch.map((item) => item.value),
                translateFromVi: translating,
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

            const pools = buildSuggestionPools(result.suggestions);

            const claimed = new Set<AiSuggestion>();
            for (const [index, item] of batch.entries()) {
              const normalized = normalizeTerm(item.value);
              const suggestion = matchSuggestion(item, index, pools, claimed);
              if (suggestion) {
                claimed.add(suggestion);
                resolved.set(normalized, readyEntry(item, suggestion, track, false));
                const key = keys.get(item.value);
                if (key) toCache.push({ key, suggestion });
              } else {
                resolved.set(
                  normalized,
                  failedEntry(
                    item.value,
                    'Groq không trả về mục này. Bấm thử lại — các từ đã xong được giữ nguyên.',
                  ),
                );
              }
            }

            processed += batch.length;
            setDone((value) => Math.min(items.length, value + batch.length));
            setEntries(mergeEntries(terms, resolved, kept));
          } catch (caught) {
            if (controller.signal.aborted) break;
            const view = describeAiError(caught, 'Groq');
            stopped = view.hint ? `${view.title}. ${view.hint}` : view.body;
            // Do not retry a key/quota problem once per batch: mark everything
            // still unresolved with the same honest reason and stop.
            for (const item of pending) {
              const key = normalizeTerm(item.value);
              if (resolved.has(key)) continue;
              resolved.set(key, failedEntry(item.value, stopped));
            }
            setEntries(mergeEntries(terms, resolved, kept));
            break;
          }
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
        const translated = ready.filter((entry) => entry.sourceTerm).length;
        const pieces: string[] = [];
        if (cacheHits > 0) pieces.push(`${cacheHits} từ lấy từ bộ nhớ đệm, không tốn lượt gọi`);
        if (translated > 0) pieces.push(`${translated} mục tiếng Việt đã được dịch sang tiếng Anh`);
        if (ready.length > 0) pieces.push(`${ready.length} từ đã có nghĩa tiếng Việt`);
        if (items.length > BATCH_SIZE) pieces.push('danh sách dài được chia thành nhiều đợt');
        setNote(pieces.length > 0 ? pieces.join(' · ') : null);
      }

      if (abortRef.current === controller) abortRef.current = null;
      runningRef.current = false;
      setRunning(false);
    },
    [db, track, level, topic, model],
  );

  const lookUp = useCallback(() => {
    void run(parsed.items);
  }, [run, parsed.items]);

  const retryFailed = useCallback(() => {
    const failed = entries.filter((entry) => entry.status === 'failed');
    if (failed.length === 0) return;
    const kept = entries.filter((entry) => entry.status !== 'failed');
    void run(
      failed.map((entry) => ({
        // A failed row is addressed by the text the learner typed, which for a
        // Vietnamese row is the row key itself.
        value: entry.sourceTerm ?? entry.term,
        language: entry.language,
      })),
      kept,
    );
  }, [entries, run]);

  const toggle = useCallback((normalized: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(normalized)) next.delete(normalized);
      else next.add(normalized);
      return next;
    });
  }, []);

  const chooseOption = useCallback((normalized: string, term: string) => {
    // The meaning, level and example stay as Groq wrote them for the first
    // option; only the saved English term follows the learner's choice.
    setEntries((previous) =>
      previous.map((entry) => (entry.normalized === normalized ? { ...entry, term } : entry)),
    );
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
    vietnameseCount: parsed.vietnamese.length,
    translatedCount: entries.filter((entry) => entry.status === 'ready' && entry.sourceTerm).length,
    chooseOption,
    lookUp,
    retryFailed,
    cancel,
    clear,
  };
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SQLiteDatabase } from 'expo-sqlite';

import { generateVocabulary } from '../ai';
import { estimateLevels } from '../ai/levels';
import { createSqliteDictCache } from '../db/dictCache';
import { packLevel } from '../data/packs';
import { parseWordList } from '../dict/list';
import { createHttpClient, lookupWords } from '../dict/lookup';
import type { DictEntry } from '../dict/types';
import type { AiProvider, Level, Track } from '../types';

/**
 * State machine for "paste a list of words".
 *
 * The lookup never blocks the whole screen: each word lands in `entries` as
 * soon as it settles, so a 30-word list fills in progressively and one slow
 * word cannot hide the other 29.
 *
 * Levels are worked out by the app, never taken from a picker: the bundled
 * packs answer instantly for words we already curated, and one batch AI request
 * answers the rest. Words nobody can rate keep `level: null` and are shown as
 * unknown instead of being silently filed under a level the learner clicked.
 */
export interface WordListLookup {
  text: string;
  setText: (value: string) => void;
  parsed: ReturnType<typeof parseWordList>;
  entries: DictEntry[];
  selected: Set<string>;
  toggle: (normalized: string) => void;
  selectAll: (include: boolean) => void;
  running: boolean;
  elapsed: number;
  done: number;
  total: number;
  error: string | null;
  /** True while the single batch level request is in flight. */
  levelsBusy: boolean;
  /** Why some levels are missing (no key, network…), if they are. */
  levelError: string | null;
  /** Found words with a Vietnamese meaning but no estimated level. */
  unknownLevels: number;
  lookUp: () => void;
  retryFailed: () => void;
  cancel: () => void;
  clear: () => void;
}

export interface UseWordListLookupOptions {
  db: SQLiteDatabase | null;
  track: Track;
  level: Level;
  topic: string;
  provider: AiProvider;
  aiModel: string;
}

/** Fold in the bundled-pack level, which costs nothing and never fails. */
function withPackLevel(entry: DictEntry, track: Track): DictEntry {
  if (entry.status !== 'found' || entry.level !== null) return entry;
  const level = packLevel(entry.term, track);
  return level === null ? entry : { ...entry, level, levelSource: 'pack' };
}

export function useWordListLookup(options: UseWordListLookupOptions): WordListLookup {
  const { db, track, level, topic, provider, aiModel } = options;

  const [text, setText] = useState('');
  const [entries, setEntries] = useState<DictEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [levelsBusy, setLevelsBusy] = useState(false);
  const [levelError, setLevelError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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
    setRunning(false);
    setLevelsBusy(false);
  }, []);

  const run = useCallback(
    async (terms: string[], startingEntries: DictEntry[] = []) => {
      if (!db || running || terms.length === 0) return;
      const controller = new AbortController();
      abortRef.current = controller;

      setRunning(true);
      setError(null);
      setLevelError(null);
      setLevelsBusy(false);
      setDone(0);
      setTotal(terms.length);
      setEntries(startingEntries);

      const collected = new Map<string, DictEntry>();
      let settledCount = 0;
      const cache = createSqliteDictCache(db);
      const client = createHttpClient();

      // Start the one level request now, in parallel with the dictionary. The
      // learner waits for the slower of the two instead of the sum of both, and
      // words the bundled packs already know never join this request.
      const needsLevels = [...new Set(terms)].filter((term) => packLevel(term, track) === null);
      setLevelsBusy(needsLevels.length > 0);
      const levelsPromise =
        needsLevels.length > 0
          ? estimateLevels(needsLevels, {
              provider,
              model: aiModel,
              signal: controller.signal,
            })
          : Promise.resolve({ levels: new Map<string, Level>(), error: null });

      try {
        const result = await lookupWords(terms, {
          client,
          cache,
          signal: controller.signal,
          onEntry: (entry) => {
            collected.set(entry.normalized, entry);
            settledCount += 1;
            setDone(settledCount);
            // Merge into the existing list so a retry keeps earlier results.
            setEntries((previous) => {
              const next = [...previous];
              for (const item of collected.values()) {
                const position = next.findIndex((entry) => entry.normalized === item.normalized);
                if (position >= 0) next[position] = item;
                else next.push(item);
              }
              return next;
            });
          },
          // Vietnamese meanings are the one thing a dictionary can miss; the AI
          // fills at most five, and every filled word records which source it
          // came from.
          aiTranslate: async (term) => {
            if (controller.signal.aborted) return null;
            try {
              const result = await generateVocabulary(
                {
                  track,
                  level,
                  topic: topic.trim() || null,
                  count: 1,
                  lookupTerm: term,
                  avoidTerms: [],
                  weakTerms: [],
                },
                { provider, model: aiModel, signal: controller.signal },
              );
              const suggestion = result.suggestions[0];
              return suggestion?.meaningVi ? { meaningVi: suggestion.meaningVi } : null;
            } catch {
              return null;
            }
          },
          aiTranslateLimit: 5,
        });

        if (controller.signal.aborted) return;

        // A retry only re-queries the failed words; keep the ones already found.
        const merged = new Map(startingEntries.map((entry) => [entry.normalized, entry]));
        for (const entry of result) merged.set(entry.normalized, entry);
        const withLevels = [...merged.values()].map((entry) => withPackLevel(entry, track));

        setEntries(withLevels);
        setSelected(
          new Set(
            withLevels
              .filter((entry) => entry.status === 'found' && Boolean(entry.meaningVi))
              .map((entry) => entry.normalized),
          ),
        );

        const failed = result.filter((entry) => entry.status === 'failed').length;
        if (failed > 0) {
          setError(
            `${failed} từ chưa tra được vì lỗi mạng hoặc từ điển. Các từ còn lại đã sẵn sàng.`,
          );
        }

        const estimate = await levelsPromise;
        if (controller.signal.aborted) return;

        if (estimate.levels.size > 0) {
          setEntries((previous) =>
            previous.map((entry) => {
              const estimated = estimate.levels.get(entry.normalized);
              return estimated === undefined
                ? entry
                : { ...entry, level: estimated, levelSource: 'ai' };
            }),
          );
        }
        setLevelError(estimate.error);
      } catch (caught) {
        if (!controller.signal.aborted) {
          setError(
            caught instanceof Error
              ? caught.message
              : 'Không tra được từ điển. Kiểm tra kết nối rồi thử lại.',
          );
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setRunning(false);
        setLevelsBusy(false);
      }
    },
    [db, running, track, level, topic, provider, aiModel],
  );

  const lookUp = useCallback(() => {
    void run(parsed.terms);
  }, [run, parsed.terms]);

  const retryFailed = useCallback(() => {
    const failed = entries.filter((entry) => entry.status === 'failed');
    if (failed.length === 0) return;
    const terms = failed.map((entry) => entry.term);
    const kept = entries.filter((entry) => entry.status !== 'failed');
    void run(terms, kept);
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
            .filter((entry) => entry.status === 'found' && Boolean(entry.meaningVi))
            .map((entry) => entry.normalized),
        ),
      );
    },
    [entries],
  );

  const clear = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
    setLevelsBusy(false);
    setEntries([]);
    setSelected(new Set());
    setError(null);
    setLevelError(null);
    setDone(0);
    setTotal(0);
  }, []);

  const unknownLevels = entries.filter(
    (entry) => entry.status === 'found' && Boolean(entry.meaningVi) && entry.level === null,
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
    levelsBusy,
    levelError,
    unknownLevels,
    lookUp,
    retryFailed,
    cancel,
    clear,
  };
}

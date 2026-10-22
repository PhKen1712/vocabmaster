import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SQLiteDatabase } from 'expo-sqlite';

import { generateVocabulary } from '../ai/gemini';
import { createSqliteDictCache } from '../db/dictCache';
import { parseWordList } from '../dict/list';
import { createHttpClient, lookupWords } from '../dict/lookup';
import type { DictEntry } from '../dict/types';
import type { Level, Track } from '../types';

/**
 * State machine for "paste a list of words".
 *
 * The lookup never blocks the whole screen: each word lands in `entries` as
 * soon as it settles, so a 30-word list fills in progressively and one slow
 * word cannot hide the other 29.
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
  aiModel: string;
}

export function useWordListLookup(options: UseWordListLookupOptions): WordListLookup {
  const { db, track, level, topic, aiModel } = options;

  const [text, setText] = useState('');
  const [entries, setEntries] = useState<DictEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
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
  }, []);

  const run = useCallback(
    async (terms: string[], startingEntries: DictEntry[] = []) => {
      if (!db || running || terms.length === 0) return;
      const controller = new AbortController();
      abortRef.current = controller;

      setRunning(true);
      setError(null);
      setDone(0);
      setTotal(terms.length);
      setEntries(startingEntries);

      const collected = new Map<string, DictEntry>();
      let settledCount = 0;
      const cache = createSqliteDictCache(db);
      const client = createHttpClient();

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
          // Vietnamese meanings are the one thing a dictionary can miss; Gemini
          // fills at most five, and every filled word is labelled `gemini`.
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
                { model: aiModel, signal: controller.signal },
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

        setEntries(result);
        setSelected(
          new Set(
            result
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
      }
    },
    [db, running, track, level, topic, aiModel],
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
    setEntries([]);
    setSelected(new Set());
    setError(null);
    setDone(0);
    setTotal(0);
  }, []);

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
    lookUp,
    retryFailed,
    cancel,
    clear,
  };
}

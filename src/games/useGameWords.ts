import { useEffect, useMemo, useState } from 'react';

import { getWeakWords, listWords } from '../db/words';
import { displayTerm } from '../lib/text';
import { useApp } from '../state/AppProvider';
import type { Track, Word } from '../types';

/**
 * Game words come from the learner's own collection for the active track.
 *
 * Words the learner keeps getting wrong come first, then the rest in a fresh
 * shuffled order each session, so a large collection is actually used instead
 * of replaying the same alphabetical handful. Terms are shown without a
 * leading "to " so a verb such as "to borrow" is typed as "borrow", matching
 * how the quiz accepts answers.
 */
export function useGameWords(track: Track): {
  words: Word[];
  pool: { term: string; meaningVi: string; level: Word['level'] }[];
  loading: boolean;
} {
  const { db, dataVersion } = useApp();
  const [words, setWords] = useState<Word[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!db) return;

    (async () => {
      setLoading(true);
      try {
        const [rows, weak] = await Promise.all([
          listWords(db, { track, limit: 400, sort: 'alpha' }),
          getWeakWords(db, track, 30),
        ]);
        const seen = new Set<string>();
        const merged: Word[] = [];
        for (const row of [...weak.map((item) => item.word), ...rows]) {
          if (seen.has(row.id)) continue;
          seen.add(row.id);
          merged.push(row);
        }
        // Fisher–Yates: weak words stay at the head, everything else varies.
        const weakCount = Math.min(weak.length, merged.length);
        for (let i = merged.length - 1; i > weakCount; i -= 1) {
          const j = weakCount + Math.floor(Math.random() * (i - weakCount + 1));
          const a = merged[i];
          const b = merged[j];
          if (a && b) {
            merged[i] = b;
            merged[j] = a;
          }
        }
        // Games practise words the learner has already met. A brand-new word
        // is introduced on the learning screen first; a completely fresh
        // collection may still play so the arcade is never empty.
        const studied = merged.filter((word) => word.reps > 0);
        if (!cancelled) setWords(studied.length > 0 ? studied : merged);
      } catch {
        if (!cancelled) setWords([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [db, track, dataVersion]);

  const pool = useMemo(() => {
    const seen = new Set<string>();
    const result: { term: string; meaningVi: string; level: Word['level'] }[] = [];
    for (const word of words) {
      const term = displayTerm(word.term).trim();
      const meaningVi = word.meaningVi.trim();
      if (!term || !meaningVi) continue;
      const key = term.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ term, meaningVi, level: word.level });
    }
    return result;
  }, [words]);

  return { words, pool, loading };
}

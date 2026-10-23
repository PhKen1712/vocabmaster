/**
 * "Cặp đôi từ vựng" — a memory match game built from the learner's own words.
 *
 * Flipping a card costs a move, so the game rewards remembering *where* the
 * Vietnamese meaning was, not just guessing. A pair is only completed when the
 * English term and its meaning are matched, which keeps the association in
 * focus. Mismatched cards stay visible for a moment so the learner can review
 * the pair before it closes; the screen calls resolveMemory after the pause,
 * which keeps the engine free of timers.
 */

import { shuffle } from '../quiz/generator';

export interface MemoryWord {
  term: string;
  meaningVi: string;
}

export interface MemoryCard {
  id: string;
  pairId: string;
  kind: 'term' | 'meaning';
  text: string;
  matched: boolean;
}

export interface MemoryState {
  cards: MemoryCard[];
  open: string[];
  wrongPair: string[] | null;
  flips: number;
  matchedPairs: number;
  totalPairs: number;
  status: 'playing' | 'over';
}

export function createMemory(
  words: MemoryWord[],
  pairs = 6,
  rng: () => number = Math.random,
): MemoryState {
  const seen = new Set<string>();
  const chosen = shuffle(
    words.filter((word) => word.term.trim() && word.meaningVi.trim()),
    rng,
  )
    .filter((word) => {
      const key = `${word.term.toLowerCase()}|${word.meaningVi.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, Math.max(1, pairs));

  const cards: MemoryCard[] = chosen.flatMap((word, index) => [
    { id: `${index}:term`, pairId: String(index), kind: 'term', text: word.term, matched: false },
    {
      id: `${index}:meaning`,
      pairId: String(index),
      kind: 'meaning',
      text: word.meaningVi,
      matched: false,
    },
  ]);

  return {
    cards: shuffle(cards, rng),
    open: [],
    wrongPair: null,
    flips: 0,
    matchedPairs: 0,
    totalPairs: chosen.length,
    status: chosen.length > 0 ? 'playing' : 'over',
  };
}

export function flipMemory(state: MemoryState, cardId: string): MemoryState {
  if (state.status !== 'playing' || state.wrongPair) return state;
  const card = state.cards.find((candidate) => candidate.id === cardId);
  if (!card || card.matched || state.open.includes(cardId)) return state;

  const flips = state.flips + 1;

  if (state.open.length === 0) {
    return { ...state, open: [cardId], flips };
  }

  const first = state.cards.find((candidate) => candidate.id === state.open[0]);
  if (!first) return { ...state, open: [cardId], flips };

  if (first.pairId === card.pairId) {
    const matchedPairs = state.matchedPairs + 1;
    return {
      ...state,
      cards: state.cards.map((candidate) =>
        candidate.pairId === card.pairId ? { ...candidate, matched: true } : candidate,
      ),
      open: [],
      flips,
      matchedPairs,
      status: matchedPairs >= state.totalPairs ? 'over' : 'playing',
    };
  }

  return { ...state, open: [...state.open, cardId], wrongPair: [state.open[0] ?? cardId], flips };
}

/** Close a mismatched pair after the review pause. */
export function resolveMemory(state: MemoryState): MemoryState {
  if (!state.wrongPair) return state;
  return { ...state, open: [], wrongPair: null };
}

/** Accuracy of the run, for the result card. */
export function memoryAccuracy(state: MemoryState): number {
  if (state.flips === 0) return 0;
  return Math.round((state.matchedPairs / state.flips) * 100);
}

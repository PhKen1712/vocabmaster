/**
 * "Thiên thạch từ vựng" — typing arcade.
 *
 * Rules that make it a vocabulary game rather than a typing test:
 * - every asteroid carries the English word *and* its Vietnamese meaning, so
 *   the learner reads the meaning while hunting for the word;
 * - typing a prefix highlights the only candidates; a full match destroys the
 *   asteroid, and a prefix that matches nothing clears the input and breaks the
 *   combo (no partial credit, no guessing);
 * - a word that reaches the bottom costs one of three shields.
 *
 * The engine is pure and time-driven: the screen passes elapsed milliseconds,
 * which makes every rule unit-testable without a timer.
 */

import { normalizeTerm } from '../lib/text';

export interface AsteroidWord {
  term: string;
  meaningVi: string;
}

export interface Asteroid {
  id: number;
  term: string;
  meaning: string;
  /** 0–1 across the play area. */
  x: number;
  /** 0–1 down the play area; 1 means it reached the bottom. */
  y: number;
  /** Fraction of the play area per second. */
  speed: number;
}

export type AsteroidStatus = 'ready' | 'playing' | 'over';

export interface AsteroidState {
  status: AsteroidStatus;
  asteroids: Asteroid[];
  typed: string;
  score: number;
  combo: number;
  bestCombo: number;
  lives: number;
  hits: number;
  missed: number;
  elapsedMs: number;
  nextSpawnMs: number;
  nextId: number;
  /** Set when an asteroid was destroyed this tick, for the burst animation. */
  lastDestroyed: Asteroid | null;
  /** Set when an asteroid was missed this tick. */
  lastMissed: Asteroid | null;
}

export const ASTEROID_LIVES = 3;
export const ASTEROID_MAX_ON_SCREEN = 5;
export const ASTEROID_SPAWN_MS = 2_400;

export function createAsteroidGame(): AsteroidState {
  return {
    status: 'ready',
    asteroids: [],
    typed: '',
    score: 0,
    combo: 0,
    bestCombo: 0,
    lives: ASTEROID_LIVES,
    hits: 0,
    missed: 0,
    elapsedMs: 0,
    nextSpawnMs: 600,
    nextId: 1,
    lastDestroyed: null,
    lastMissed: null,
  };
}

export function startAsteroidGame(state: AsteroidState): AsteroidState {
  return { ...createAsteroidGame(), status: 'playing' };
}

/** Pick a word that is not already falling; fall back to any word. */
export function pickAsteroidWord(
  pool: AsteroidWord[],
  active: Asteroid[],
  rng: () => number = Math.random,
): AsteroidWord | null {
  const usable = pool.filter((word) => word.term.trim() && word.meaningVi.trim());
  if (usable.length === 0) return null;
  const activeTerms = new Set(active.map((asteroid) => normalizeTerm(asteroid.term)));
  const fresh = usable.filter((word) => !activeTerms.has(normalizeTerm(word.term)));
  const source = fresh.length > 0 ? fresh : usable;
  return source[Math.floor(rng() * source.length)] ?? null;
}

/** Faster as the run goes on, but capped so long words stay typeable. */
export function asteroidSpeed(elapsedMs: number): number {
  return 0.04 + Math.min(0.05, (elapsedMs / 1_000) * 0.0009);
}

export function spawnAsteroid(
  state: AsteroidState,
  pool: AsteroidWord[],
  rng: () => number = Math.random,
): AsteroidState {
  if (state.status !== 'playing' || state.asteroids.length >= ASTEROID_MAX_ON_SCREEN) {
    return state;
  }
  const word = pickAsteroidWord(pool, state.asteroids, rng);
  if (!word) return state;

  const asteroid: Asteroid = {
    id: state.nextId,
    term: word.term,
    meaning: word.meaningVi,
    x: 0.08 + rng() * 0.84,
    y: -0.08,
    speed: asteroidSpeed(state.elapsedMs),
  };

  return {
    ...state,
    asteroids: [...state.asteroids, asteroid],
    nextId: state.nextId + 1,
    nextSpawnMs: state.elapsedMs + ASTEROID_SPAWN_MS,
  };
}

export function tickAsteroid(
  state: AsteroidState,
  dtMs: number,
  pool: AsteroidWord[],
  rng: () => number = Math.random,
): AsteroidState {
  if (state.status !== 'playing') return state;

  const elapsedMs = state.elapsedMs + Math.max(0, dtMs);
  const falling: Asteroid[] = [];
  const survived: Asteroid[] = [];
  const missed: Asteroid[] = [];

  for (const asteroid of state.asteroids) {
    const y = asteroid.y + asteroid.speed * (dtMs / 1_000);
    if (y >= 1) missed.push(asteroid);
    else survived.push({ ...asteroid, y });
    falling.push(asteroid);
  }

  let next: AsteroidState = {
    ...state,
    asteroids: survived,
    elapsedMs,
    lastDestroyed: null,
    lastMissed: missed[0] ?? null,
  };

  if (missed.length > 0) {
    next = {
      ...next,
      lives: Math.max(0, state.lives - missed.length),
      combo: 0,
      missed: state.missed + missed.length,
      typed: '',
    };
    if (next.lives === 0) next.status = 'over';
  }

  if (next.status === 'playing' && elapsedMs >= next.nextSpawnMs) {
    next = spawnAsteroid(next, pool, rng);
  }

  return next;
}

export interface TypeResult {
  state: AsteroidState;
  destroyed: Asteroid | null;
  /** True when the input no longer matches any falling word. */
  wrong: boolean;
}

/**
 * Feed the whole input value (not one character): paste and autocomplete from
 * the keyboard then behave exactly like typing.
 */
export function typeAsteroid(state: AsteroidState, raw: string): TypeResult {
  if (state.status !== 'playing') return { state, destroyed: null, wrong: false };

  const value = raw.replace(/\s+/g, ' ').slice(0, 48);
  if (!value.trim()) {
    return { state: { ...state, typed: '' }, destroyed: null, wrong: false };
  }

  const typed = normalizeTerm(value);
  const matches = state.asteroids.filter((asteroid) =>
    normalizeTerm(asteroid.term).startsWith(typed),
  );

  if (matches.length === 0) {
    // A wrong key is feedback, not a reset of the whole run: combo breaks and
    // the input clears so the learner can immediately try another word.
    return {
      state: { ...state, typed: '', combo: 0 },
      destroyed: null,
      wrong: true,
    };
  }

  const exact = matches.find((asteroid) => normalizeTerm(asteroid.term) === typed);
  if (!exact) {
    return { state: { ...state, typed: value }, destroyed: null, wrong: false };
  }

  const combo = state.combo + 1;
  const points = 10 + (combo - 1) * 5;
  return {
    state: {
      ...state,
      asteroids: state.asteroids.filter((asteroid) => asteroid.id !== exact.id),
      typed: '',
      score: state.score + points,
      combo,
      bestCombo: Math.max(state.bestCombo, combo),
      hits: state.hits + 1,
      lastDestroyed: exact,
    },
    destroyed: exact,
    wrong: false,
  };
}

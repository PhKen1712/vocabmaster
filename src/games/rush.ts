/**
 * "60 giây" — a fast meaning quiz.
 *
 * Adapted from the classroom idea of a speed round: one English word, four
 * Vietnamese meanings, 60 seconds, and a combo that rewards answering without
 * hesitating. A wrong answer costs time instead of ending the run, so one
 * mistake never wastes the whole minute.
 */

import { shuffle } from '../quiz/generator';

export interface RushWord {
  term: string;
  meaningVi: string;
}

export interface RushQuestion {
  term: string;
  options: string[];
  answerIndex: number;
}

export type RushStatus = 'ready' | 'playing' | 'over';

export interface RushState {
  status: RushStatus;
  questions: RushQuestion[];
  index: number;
  score: number;
  combo: number;
  bestCombo: number;
  correct: number;
  wrong: number;
  timeLeftMs: number;
  durationMs: number;
  /** Last answer, kept so the card can flash green or red. */
  feedback: { choice: number; correct: boolean } | null;
}

export const RUSH_DURATION_MS = 60_000;
const WRONG_PENALTY_MS = 2_500;
const CORRECT_BONUS_MS = 1_200;

/** Build questions with three plausible-but-wrong Vietnamese meanings. */
export function buildRushQuestions(
  words: RushWord[],
  count = 24,
  rng: () => number = Math.random,
): RushQuestion[] {
  const usable = words.filter((word) => word.term.trim() && word.meaningVi.trim());
  const meanings = [...new Set(usable.map((word) => word.meaningVi))];
  if (usable.length < 4 || meanings.length < 4) return [];

  return shuffle(usable, rng)
    .slice(0, Math.max(1, count))
    .map((word) => {
      const distractors = shuffle(
        meanings.filter((meaning) => meaning !== word.meaningVi),
        rng,
      ).slice(0, 3);
      if (distractors.length < 3) return null;
      const options = shuffle([word.meaningVi, ...distractors], rng);
      return {
        term: word.term,
        options,
        answerIndex: options.indexOf(word.meaningVi),
      } satisfies RushQuestion;
    })
    .filter((question): question is RushQuestion => question !== null);
}

export function createRush(
  words: RushWord[],
  rng: () => number = Math.random,
  durationMs = RUSH_DURATION_MS,
): RushState {
  const questions = buildRushQuestions(words, 24, rng);
  return {
    status: questions.length > 0 ? 'ready' : 'over',
    questions,
    index: 0,
    score: 0,
    combo: 0,
    bestCombo: 0,
    correct: 0,
    wrong: 0,
    timeLeftMs: durationMs,
    durationMs,
    feedback: null,
  };
}

export function startRush(state: RushState): RushState {
  return { ...state, status: state.questions.length > 0 ? 'playing' : 'over' };
}

export function tickRush(state: RushState, dtMs: number): RushState {
  if (state.status !== 'playing') return state;
  const timeLeftMs = Math.max(0, state.timeLeftMs - Math.max(0, dtMs));
  return {
    ...state,
    timeLeftMs,
    status: timeLeftMs <= 0 ? 'over' : 'playing',
  };
}

export function answerRush(state: RushState, choice: number): RushState {
  if (state.status !== 'playing') return state;
  const question = state.questions[state.index];
  if (!question) return { ...state, status: 'over' };

  const correct = choice === question.answerIndex;
  const combo = correct ? state.combo + 1 : 0;
  const gained = correct ? 10 + (combo - 1) * 3 : 0;
  const timeLeftMs = Math.min(
    state.durationMs,
    Math.max(
      0,
      state.timeLeftMs + (correct ? CORRECT_BONUS_MS : -WRONG_PENALTY_MS),
    ),
  );
  const nextIndex = state.index + 1;
  const finished = nextIndex >= state.questions.length;

  return {
    ...state,
    index: finished ? state.index : nextIndex,
    score: state.score + gained,
    combo,
    bestCombo: Math.max(state.bestCombo, combo),
    correct: state.correct + (correct ? 1 : 0),
    wrong: state.wrong + (correct ? 0 : 1),
    timeLeftMs,
    feedback: { choice, correct },
    status: timeLeftMs <= 0 || finished ? 'over' : 'playing',
  };
}

import type { Level, QuizQuestion, Word } from '../types';
import { generateQuestions, type Rng } from './generator';

/**
 * Placement is a self-check, not an exam. It samples one word per available
 * level and recommends a starting level; the learner keeps the final choice.
 *
 * Only multiple-choice kinds are allowed here. An earlier version also allowed
 * `typing`, whose question has `options: null`, while the screen only renders
 * option buttons — the learner saw a prompt with no way to answer (and no way
 * to continue). Placement now guarantees every question has at least two
 * options, or the level is skipped.
 */
export const PLACEMENT_KINDS = ['en_to_vi', 'vi_to_en'] as const;

/** Words tried per level before giving up on that level. */
const WORDS_PER_LEVEL = 6;

export function recommendLevel(correct: number, total: number): Level {
  if (total <= 0) return 1;
  const ratio = correct / total;
  if (ratio >= 0.95) return 5;
  if (ratio >= 0.8) return 4;
  if (ratio >= 0.6) return 3;
  if (ratio >= 0.4) return 2;
  if (ratio >= 0.2) return 1;
  return 0;
}

export function isAnswerable(
  question: QuizQuestion | null | undefined,
): question is QuizQuestion {
  return Boolean(question && Array.isArray(question.options) && question.options.length >= 2);
}

/**
 * One answerable question per level, easiest level first. Levels whose words
 * cannot produce two distinct options are left out rather than turning into a
 * dead-end screen.
 */
export function buildPlacementQuestions(
  pool: readonly Word[],
  rng: Rng = Math.random,
): QuizQuestion[] {
  const byLevel = new Map<Level, Word[]>();
  for (const word of pool) {
    const bucket = byLevel.get(word.level) ?? [];
    if (bucket.length < WORDS_PER_LEVEL) bucket.push(word);
    byLevel.set(word.level, bucket);
  }

  const questions: QuizQuestion[] = [];
  const levels = [...byLevel.keys()].sort((a, b) => a - b);
  for (const level of levels) {
    for (const word of byLevel.get(level) ?? []) {
      const [candidate] = generateQuestions([word], pool, {
        kinds: [...PLACEMENT_KINDS],
        limit: 1,
        rng,
      });
      if (isAnswerable(candidate)) {
        questions.push(candidate);
        break;
      }
    }
  }
  return questions;
}

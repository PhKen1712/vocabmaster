import { levenshtein, normalizeAnswer } from '../lib/text';
import type { QuizQuestion } from '../types';

export interface GradeResult {
  correct: boolean;
  normalized: string;
  expected: string;
  /** True when a typed answer is one edit away (shown as a hint, still wrong). */
  nearMiss: boolean;
}

/**
 * Grade an answer.
 *
 * Option questions compare ids, so two options with the same text can never be
 * scored inconsistently. Typed answers ignore case, punctuation and extra
 * spaces; a one-character miss is reported as a near miss but is NOT counted as
 * correct, because spelling is part of vocabulary knowledge.
 */
export function gradeAnswer(
  question: QuizQuestion,
  response: { optionId?: string | null; text?: string | null },
): GradeResult {
  const expected = question.answerText;

  if (question.options) {
    const correct = Boolean(response.optionId) && response.optionId === question.answerId;
    return {
      correct,
      normalized: response.optionId ?? '',
      expected,
      nearMiss: false,
    };
  }

  const normalized = normalizeAnswer(response.text ?? '');
  const accepted = question.accepted.length > 0
    ? question.accepted
    : [normalizeAnswer(expected)];
  const correct = normalized.length > 0 && accepted.includes(normalized);

  const nearMiss =
    !correct &&
    normalized.length > 0 &&
    accepted.some((value) => {
      if (value.length < 4) return false;
      return levenshtein(normalized, value) <= 1;
    });

  return { correct, normalized, expected, nearMiss };
}

/** Speech transcripts get the same normalization as typed answers. */
export function gradeSpokenAnswer(question: QuizQuestion, transcript: string): GradeResult {
  return gradeAnswer(question, { text: transcript });
}

/** Compare a spoken sentence with the target word/sentence, word by word. */
export function compareSpokenWords(
  target: string,
  transcript: string,
): { spoken: string[]; expected: string[]; matched: string[] } {
  const normalizeWords = (value: string) =>
    normalizeAnswer(value)
      .split(' ')
      .filter(Boolean);
  const expected = normalizeWords(target);
  const spoken = normalizeWords(transcript);
  const matched = expected.filter((word) => spoken.includes(word));
  return { spoken, expected, matched };
}

export function accuracyOf(correct: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, correct / total));
}

import { compareSpokenWords, gradeSpokenAnswer } from '../quiz/grading';
import type { QuizQuestion } from '../types';

/**
 * What this module can and cannot do — important for honest feedback:
 *
 * CAN: use Apple's Speech framework to transcribe what the learner said, check
 * whether the target word (or its parts, for a phrase) was recognised, and
 * report the recogniser's per-segment confidence.
 *
 * CANNOT: score phonemes, stress or individual sounds. Speech recognition
 * confidence measures how sure the engine is about the words it heard, not how
 * well the learner pronounced them. The UI must say so; no number here is
 * presented as a "pronunciation score".
 */

export interface SpokenSegment {
  text: string;
  confidence: number;
}

export interface SpeechCheckResult {
  /** Exact/normalized match of the whole target. */
  wordMatched: boolean;
  transcript: string;
  target: string;
  matchedWords: string[];
  missedWords: string[];
  /** Recogniser confidence for the matched segment, 0 when unavailable. */
  confidence: number;
  segments: SpokenSegment[];
  /** Explanation to show under the result. */
  note: string;
}

export function buildSpeechCheck(
  question: QuizQuestion,
  transcript: string,
  segments: SpokenSegment[] = [],
): SpeechCheckResult {
  const target = question.answerText;
  const grade = gradeSpokenAnswer(question, transcript);
  const comparison = compareSpokenWords(question.prompt, transcript);
  const matchedWords =
    question.kind === 'speaking'
      ? comparison.matched
      : question.accepted.includes(grade.normalized)
        ? [target]
        : [];
  const missedWords = comparison.expected.filter((word) => !comparison.matched.includes(word));

  const targetSegment = segments.find((segment) =>
    target.toLowerCase().includes(segment.text.toLowerCase()),
  );

  const note = grade.correct
    ? 'Hệ thống nhận đúng từ bạn đọc. Đây là so khớp từ, không phải điểm phát âm từng âm.'
    : 'Hệ thống chưa nhận ra đúng từ. Hãy nghe lại, đọc chậm hơn và thử ở nơi ít tiếng ồn.';

  return {
    wordMatched: grade.correct,
    transcript,
    target,
    matchedWords,
    missedWords,
    confidence: typeof targetSegment?.confidence === 'number' ? targetSegment.confidence : 0,
    segments,
    note,
  };
}

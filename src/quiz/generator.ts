import { displayTerm, normalizeAnswer, normalizeTerm, uniqueStrings } from '../lib/text';
import type { QuizKind, QuizOption, QuizQuestion, Word } from '../types';
import { bilingualDescription } from './description';

export type Rng = () => number;

/**
 * Quiz generation rules:
 * - Every question is built only from words that exist in the local database.
 * - Options are de-duplicated by label; the correct answer is always present.
 * - If fewer than two valid distractors exist, the generator falls back to a
 *   typed answer instead of inventing plausible-looking wrong answers.
 * - Cloze/context questions are only created when the required source text
 *   (example sentence / English definition) actually exists and contains the
 *   target word.
 */

const ROTATION: QuizKind[] = [
  'en_to_vi',
  'typing',
  'cloze',
  'listening',
  'vi_to_en',
  'context',
  'speaking',
  'confusable',
];

export function shuffle<T>(items: readonly T[], rng: Rng = Math.random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = copy[i];
    const b = copy[j];
    if (a !== undefined && b !== undefined) {
      copy[i] = b;
      copy[j] = a;
    }
  }
  return copy;
}

function pickDistractors(
  word: Word,
  pool: readonly Word[],
  labelOf: (candidate: Word) => string,
  count: number,
  rng: Rng,
): Word[] {
  const correctLabel = normalizeAnswer(labelOf(word));
  const seen = new Set<string>([correctLabel]);
  const candidates = shuffle(
    pool.filter((candidate) => {
      if (candidate.id === word.id) return false;
      if (normalizeTerm(candidate.term) === normalizeTerm(word.term)) return false;
      const label = normalizeAnswer(labelOf(candidate));
      if (!label || seen.has(label)) return false;
      seen.add(label);
      return true;
    }),
    rng,
  );
  return candidates.slice(0, Math.max(0, count));
}

function optionSet(
  word: Word,
  distractors: Word[],
  labelOf: (candidate: Word) => string,
  rng: Rng,
): QuizOption[] | null {
  const own = labelOf(word).trim();
  if (!own) return null;
  const options: QuizOption[] = [
    { id: word.id, label: own },
    ...distractors.map((candidate) => ({ id: candidate.id, label: labelOf(candidate).trim() })),
  ];
  const unique = new Map<string, QuizOption>();
  for (const option of options) {
    const key = normalizeAnswer(option.label);
    if (!key) continue;
    if (!unique.has(key)) unique.set(key, option);
  }
  const values = [...unique.values()];
  if (values.length < 2) return null;
  return shuffle(values, rng);
}

/** Escape a term for use inside a RegExp, so "get along with" is literal. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const OPTION_KINDS: QuizKind[] = [
  'en_to_vi',
  'vi_to_en',
  'cloze',
  'context',
  'listening',
  'confusable',
];

export function makeClozeSentence(word: Word): string | null {
  const example = word.exampleEn?.trim();
  if (!example) return null;
  const variants = uniqueStrings([word.term, displayTerm(word.term)]);
  for (const variant of variants) {
    if (!variant || variant.length < 2) continue;
    const pattern = new RegExp(`\\b${escapeRegExp(variant)}\\b`, 'i');
    if (pattern.test(example)) {
      return example.replace(pattern, '_____');
    }
  }
  return null;
}

function buildQuestion(
  word: Word,
  pool: readonly Word[],
  kind: QuizKind,
  rng: Rng,
): QuizQuestion | null {
  const description = bilingualDescription(word);
  const base = {
    id: `${word.id}:${kind}`,
    wordId: word.id,
    kind,
    word,
    descriptionEn: description.en,
    descriptionVi: description.vi,
  };
  const meaningOptions = () =>
    optionSet(word, pickDistractors(word, pool, (candidate) => candidate.meaningVi, 3, rng), (candidate) => candidate.meaningVi, rng);
  const termOptions = () =>
    optionSet(word, pickDistractors(word, pool, (candidate) => candidate.term, 3, rng), (candidate) => candidate.term, rng);
  const helper = [word.ipa, word.partOfSpeech].filter(Boolean).join(' · ') || null;

  switch (kind) {
    case 'en_to_vi': {
      const options = meaningOptions();
      if (!options) return null;
      return {
        ...base,
        prompt: word.term,
        helper,
        example: null,
        options,
        answerId: word.id,
        answerText: word.meaningVi,
        accepted: [normalizeAnswer(word.meaningVi)],
      };
    }
    case 'vi_to_en': {
      const options = termOptions();
      if (!options) return null;
      return {
        ...base,
        // Sanitised: a stored meaning that mentions the English term must not
        // hand the learner the answer on an IELTS prompt either.
        prompt: description.vi || word.meaningVi,
        helper: word.topic ? `Chủ đề: ${word.topic}` : null,
        example: null,
        options,
        answerId: word.id,
        answerText: word.term,
        accepted: [normalizeAnswer(word.term), normalizeAnswer(displayTerm(word.term))],
      };
    }
    case 'listening': {
      const options = termOptions();
      if (!options) return null;
      return {
        ...base,
        prompt: 'Nghe và chọn từ bạn nghe được',
        helper: 'Nhấn biểu tượng loa để nghe lại',
        example: null,
        options,
        answerId: word.id,
        answerText: word.term,
        accepted: [normalizeAnswer(word.term)],
      };
    }
    case 'confusable': {
      const siblings = pool.filter(
        (candidate) =>
          candidate.id !== word.id &&
          candidate.track === word.track &&
          candidate.partOfSpeech === word.partOfSpeech &&
          candidate.topic === word.topic,
      );
      const options = optionSet(
        word,
        pickDistractors(
          word,
          siblings.length >= 2 ? siblings : pool,
          (candidate) => candidate.term,
          3,
          rng,
        ),
        (candidate) => candidate.term,
        rng,
      );
      if (!options) return null;
      return {
        ...base,
        prompt: `Chọn từ tiếng Anh đúng cho nghĩa: "${word.meaningVi}"`,
        helper: word.partOfSpeech ? `Cùng từ loại: ${word.partOfSpeech}` : null,
        example: null,
        options,
        answerId: word.id,
        answerText: word.term,
        accepted: [normalizeAnswer(word.term)],
      };
    }
    case 'cloze': {
      const sentence = makeClozeSentence(word);
      if (!sentence) return null;
      const options = termOptions();
      if (!options) return null;
      return {
        ...base,
        prompt: sentence,
        helper: word.meaningVi,
        example: sentence,
        options,
        answerId: word.id,
        answerText: word.term,
        accepted: [normalizeAnswer(word.term)],
      };
    }
    case 'context': {
      // The definition is the entire clue. If it is missing, or it was only the
      // target word itself, there is no safe prompt — skip instead of showing
      // the raw definition and leaking the answer.
      if (!description.en) return null;
      const options = termOptions();
      if (!options) return null;
      return {
        ...base,
        prompt: description.en,
        helper: `Định nghĩa tiếng Anh · ${word.topic ?? 'General'}`,
        example: null,
        options,
        answerId: word.id,
        answerText: word.term,
        accepted: [normalizeAnswer(word.term)],
      };
    }
    case 'typing': {
      return {
        ...base,
        prompt: description.vi || word.meaningVi,
        helper: [word.partOfSpeech, word.topic].filter(Boolean).join(' · ') || null,
        example: null,
        options: null,
        answerId: null,
        answerText: word.term,
        accepted: uniqueStrings([
          normalizeAnswer(word.term),
          normalizeAnswer(displayTerm(word.term)),
          // Stored synonyms are real English replacements, so a learner who
          // types "smart" for "intelligent" is right. Other question kinds
          // (spelling, cloze, listening) stay strict: there, the exact word is
          // the thing being tested.
          ...word.synonyms.map((synonym) => normalizeAnswer(synonym)),
        ]),
      };
    }
    case 'speaking': {
      return {
        ...base,
        prompt: word.term,
        helper: helper ?? 'Đọc to từ này',
        example: word.exampleEn,
        options: null,
        answerId: null,
        answerText: word.term,
        accepted: [normalizeAnswer(word.term)],
      };
    }
    case 'recall': {
      return {
        ...base,
        prompt: word.term,
        helper: null,
        example: null,
        options: null,
        answerId: null,
        answerText: word.meaningVi,
        accepted: [normalizeAnswer(word.meaningVi)],
      };
    }
    default:
      return null;
  }
}

export interface GenerateOptions {
  limit?: number;
  kinds?: QuizKind[];
  rng?: Rng;
}

/**
 * Build one question per candidate word, rotating through question types.
 * Falls back through the rotation when a word lacks the data a type needs, so
 * every returned question is guaranteed valid.
 */
export function generateQuestions(
  candidates: readonly Word[],
  pool: readonly Word[],
  options: GenerateOptions = {},
): QuizQuestion[] {
  const rng = options.rng ?? Math.random;
  const kinds = (options.kinds && options.kinds.length > 0 ? options.kinds : ROTATION).filter(
    (kind): kind is QuizKind => ROTATION.includes(kind),
  );
  const limit = options.limit ?? candidates.length;
  const questions: QuizQuestion[] = [];
  const ordered = shuffle(candidates, rng);

  for (const word of ordered) {
    if (questions.length >= limit) break;
    let built: QuizQuestion | null = null;
    const start = Math.floor(rng() * kinds.length);
    for (let offset = 0; offset < kinds.length; offset += 1) {
      const kind = kinds[(start + offset) % kinds.length];
      if (!kind) continue;
      built = buildQuestion(word, pool, kind, rng);
      if (built) break;
    }
    if (!built) {
      built = buildQuestion(word, pool, 'typing', rng);
    }
    if (built) questions.push(built);
  }

  return questions;
}

/** Only option-based kinds can be graded automatically without speech. */
export function isOptionQuestion(question: QuizQuestion): boolean {
  return question.options !== null;
}

export function isAutoGraded(question: QuizQuestion): boolean {
  return question.kind !== 'recall';
}

export const OPTION_QUESTION_KINDS = OPTION_KINDS;

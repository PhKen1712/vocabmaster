import { displayTerm } from '../lib/text';
import type { QuizKind, Word } from '../types';

/**
 * Bilingual descriptions for General English.
 *
 * The learner reads a description and must produce the word, so the
 * description is the only clue. For General English it must exist in BOTH
 * languages: an English description of the meaning/usage and a natural
 * Vietnamese one. Both are derived from stored data first (`definitionEn` /
 * `exampleEn` and `meaningVi`); no network call is made per question and no
 * text is invented.
 *
 * The target word is replaced with a blank whenever it appears in either
 * description, so the answer is never handed to the learner by accident.
 */

export interface BilingualDescription {
  en: string | null;
  vi: string;
  /** True when both languages are present and neither leaks the answer. */
  complete: boolean;
}

const BLANK = '_____';

/** Kinds that show a description and ask for the English word. */
export const DESCRIPTION_KINDS: readonly QuizKind[] = [
  'typing',
  'vi_to_en',
  'cloze',
  'context',
];

export function isDescriptionKind(kind: QuizKind): boolean {
  return DESCRIPTION_KINDS.includes(kind);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function termVariants(term: string): string[] {
  // Keep short words too: "go" or "in" are real vocabulary, and an example
  // sentence containing them would otherwise reveal the answer. Whole-word
  // matching keeps `in` from blanking `important`.
  const variants = [term.trim(), displayTerm(term).trim()]
    .filter((value) => value.length > 0)
    .sort((a, b) => b.length - a.length);
  return [...new Set(variants)];
}

/** A description needs real words, not just the blanks left after sanitising. */
function hasContent(text: string): boolean {
  return (text.match(/[A-Za-zÀ-ỹ]/g) ?? []).length >= 2;
}

function tidy(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    // Strip separators left behind by removing the target word, but keep the
    // sentence's final full stop/question mark so it still reads naturally.
    .replace(/^[\s:;,.\-–—]+/, '')
    .replace(/[\s:;,]+$/, '')
    .trim();
}

/** Remove a verbatim target word so the description cannot reveal it. */
export function withoutAnswer(text: string, term: string): string {
  let result = text;
  for (const variant of termVariants(term)) {
    const pattern = new RegExp(`\\b${escapeRegExp(variant)}\\b`, 'gi');
    result = result.replace(pattern, BLANK);
  }
  return tidy(result);
}

/**
 * English description: the stored definition when present, otherwise a usage
 * example with the target blanked. Returns null when neither exists, so the UI
 * can say the field is missing instead of fabricating English text.
 */
export function englishDescription(word: Word): string | null {
  const definition = word.definitionEn?.trim();
  if (definition) {
    const safe = withoutAnswer(definition, word.term);
    if (hasContent(safe)) return safe;
  }
  const example = word.exampleEn?.trim();
  if (example) {
    const safe = withoutAnswer(example, word.term);
    if (hasContent(safe)) return safe;
  }
  return null;
}

export function bilingualDescription(word: Word): BilingualDescription {
  const en = englishDescription(word);
  const vi = withoutAnswer(word.meaningVi ?? '', word.term);
  return { en, vi, complete: Boolean(en) && Boolean(vi) };
}

/**
 * Whether this question should show the bilingual block. Pure listening,
 * speaking and one-way translation keep their own goals and never force a
 * translation into the prompt.
 */
export function showsBilingualDescription(word: Word, kind: QuizKind): boolean {
  return word.track === 'general' && isDescriptionKind(kind);
}

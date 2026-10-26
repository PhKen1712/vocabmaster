/**
 * Parsing for the "paste a list of words" input.
 *
 * Rules (all covered by tests):
 * - a real newline the learner typed starts a new item, one item per line;
 * - a phrase that merely wraps visually on screen is NOT split, because this
 *   only ever looks at newline characters that exist in the pasted text;
 * - commas and semicolons still separate items inside one line, so a pasted
 *   column or a one-line list both work;
 * - every item is trimmed and internal whitespace is collapsed
 *   (`civil    law` → `civil law`), while Vietnamese diacritics are untouched;
 * - empty lines are skipped;
 * - duplicates are removed case-insensitively, keeping the first spelling;
 * - multi-word items stay whole: `take into account` is ONE item, never three;
 * - each item is labelled English or Vietnamese for the importer.
 */

import { detectLanguage, type InputLanguage } from '../lib/lang';

export const MAX_LIST_WORDS = 50;
const MAX_TERM_LENGTH = 80;

export type DropReason = 'duplicate' | 'too_long' | 'not_a_word';

export interface ParsedListItem {
  value: string;
  language: InputLanguage;
}

export interface ParsedWordList {
  /** Every accepted item, in the order the learner typed it. */
  terms: string[];
  /** The same items with their detected language. */
  items: ParsedListItem[];
  /** Items the dictionary path should handle. */
  english: string[];
  /** Items Groq must turn into an English term first. */
  vietnamese: string[];
  /** Items that were dropped, with the reason, so nothing disappears silently. */
  dropped: { value: string; reason: DropReason }[];
  /** True when the input contains more items than the app will process. */
  truncated: boolean;
}

export function cleanTerm(value: string): string {
  return value
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'“”]+|[\s"'“”]+$/g, '')
    .trim();
}

export function parseWordList(input: string, max = MAX_LIST_WORDS): ParsedWordList {
  const items: ParsedListItem[] = [];
  const terms: string[] = [];
  const dropped: ParsedWordList['dropped'] = [];
  const seen = new Set<string>();
  let truncated = false;

  // Split on real newlines first (CRLF, CR and LF), then on commas/semicolons
  // inside each line.
  const raw: string[] = [];
  for (const line of (input ?? '').split(/\r\n|\r|\n/)) {
    for (const part of line.split(/[,;]+/)) raw.push(part);
  }

  for (const part of raw) {
    const value = cleanTerm(part);
    if (!value) continue;

    const key = value.toLowerCase();
    if (seen.has(key)) {
      dropped.push({ value, reason: 'duplicate' });
      continue;
    }
    if (value.length > MAX_TERM_LENGTH) {
      dropped.push({ value: value.slice(0, 24) + '…', reason: 'too_long' });
      continue;
    }

    const language = detectLanguage(value);
    // Vietnamese is accepted here exactly like English: it is translated by
    // Groq later, not rejected at the door.
    if (language === 'unknown') {
      dropped.push({ value, reason: 'not_a_word' });
      continue;
    }
    if (terms.length >= max) {
      truncated = true;
      continue;
    }

    seen.add(key);
    terms.push(value);
    items.push({ value, language });
  }

  return {
    terms,
    items,
    english: items.filter((item) => item.language === 'en').map((item) => item.value),
    vietnamese: items.filter((item) => item.language === 'vi').map((item) => item.value),
    dropped,
    truncated,
  };
}

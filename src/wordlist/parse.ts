/**
 * Parsing for the "paste a list of words" input.
 *
 * Rules (all covered by tests):
 * - split on commas, semicolons and newlines, so a pasted column also works;
 * - trim every item and collapse internal whitespace (`civil    law` → `civil law`);
 * - drop empty items from `,,` or a trailing comma;
 * - remove duplicates case-insensitively, keeping the first spelling and order;
 * - keep multi-word items intact: `take into account` is ONE item, never three.
 */

export const MAX_LIST_WORDS = 50;
const MAX_TERM_LENGTH = 80;

export interface ParsedWordList {
  /** Clean terms in the order the learner typed them. */
  terms: string[];
  /** Items that were dropped, with the reason, so nothing disappears silently. */
  dropped: { value: string; reason: 'duplicate' | 'too_long' | 'not_english' }[];
  /** True when the input contains more items than the app will process. */
  truncated: boolean;
}

/**
 * Letters, spaces, apostrophes, hyphens and dots: what a headword or a phrase
 * can contain. Phrases are deliberately allowed here; the AI, not a
 * single-word dictionary, decides what they mean.
 */
const HEADWORD = /^[a-z][a-z'’.\- ]*[a-z.]$/i;

export function cleanTerm(value: string): string {
  return value
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'“”]+|[\s"'“”]+$/g, '')
    .trim();
}

export function parseWordList(input: string, max = MAX_LIST_WORDS): ParsedWordList {
  const terms: string[] = [];
  const dropped: ParsedWordList['dropped'] = [];
  const seen = new Set<string>();
  let truncated = false;

  const raw = (input ?? '').split(/[,;\n\r]+/);

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
    if (!HEADWORD.test(value) || !/[a-z]/i.test(value)) {
      dropped.push({ value, reason: 'not_english' });
      continue;
    }
    if (terms.length >= max) {
      truncated = true;
      continue;
    }

    seen.add(key);
    terms.push(value);
  }

  return { terms, dropped, truncated };
}

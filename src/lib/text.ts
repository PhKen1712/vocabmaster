/**
 * Deterministic text helpers. Used by duplicate detection, answer grading and
 * the importer, so they must stay free of native dependencies.
 */

const APOSTROPHES = /[\u2018\u2019\u02BC]/g;
const PUNCTUATION = /[.,!?;:"()[\]{}<>/\\|@#$%^&*_+=~`]/g;

/** Trim, unify apostrophes, collapse whitespace and lowercase. */
export function normalizeTerm(value: string): string {
  return value
    .replace(APOSTROPHES, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Normalize a free-text answer for grading.
 * Capitalisation, punctuation, extra spaces and curly apostrophes are ignored
 * on purpose: those differences are not the skill being tested.
 */
export function normalizeAnswer(value: string): string {
  return normalizeTerm(value)
    .replace(PUNCTUATION, '')
    .replace(/^(to|a|an|the)\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strip a leading "to " that dictionaries use for verbs, for display only. */
export function displayTerm(term: string): string {
  return term.replace(/^to\s+/i, '');
}

export function isBlank(value: string | null | undefined): boolean {
  return !value || value.trim().length === 0;
}

/** Levenshtein distance, used only to explain near-misses, never to pass them. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = new Array<number>(b.length + 1);
  let current = new Array<number>(b.length + 1);

  for (let j = 0; j <= b.length; j += 1) previous[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    const aChar = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j += 1) {
      const cost = aChar === b.charCodeAt(j - 1) ? 0 : 1;
      const deletion = (previous[j] ?? 0) + 1;
      const insertion = (current[j - 1] ?? 0) + 1;
      const substitution = (previous[j - 1] ?? 0) + cost;
      current[j] = Math.min(deletion, insertion, substitution);
    }
    const swap = previous;
    previous = current;
    current = swap;
  }

  return previous[b.length] ?? 0;
}

/** Split a sentence into comparable words (used by speaking practice). */
export function tokenize(value: string): string[] {
  return normalizeAnswer(value)
    .split(/[^a-z0-9']+/i)
    .map((token) => token.replace(/'/g, ''))
    .filter((token) => token.length > 0);
}

export function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

/**
 * CSV parsing that understands quoted fields, escaped quotes and CRLF.
 * Returns rows of raw string cells; the importer validates each row.
 */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const text = input.replace(/^\uFEFF/, '');

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  row.push(field);
  if (row.length > 1 || field.length > 0) rows.push(row);
  return rows.filter((cells) => cells.some((cell) => cell.trim().length > 0));
}

/** Quote one CSV cell; always safe for Excel/Numbers. */
export function toCsvCell(value: string | null | undefined): string {
  const text = value ?? '';
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function formatList(values: readonly string[] | null | undefined): string {
  return (values ?? []).join(', ');
}

export function splitList(value: string | null | undefined): string[] {
  if (!value) return [];
  return uniqueStrings(
    value
      .split(/[,;|]/)
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

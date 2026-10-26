import type { AiSuggestion } from '../ai/types';
import { normalizeTerm } from '../lib/text';
import type { ParsedListItem } from './parse';

/**
 * Match each answer back to the item that asked for it.
 *
 * This is the part that has to be exact, because a mismatch would attach the
 * meaning of one word to another. Three signals are used, in this order:
 *
 * 1. `sourceVi` — a Vietnamese item comes back with an English `term`, so the
 *    only trustworthy link is the learner's own text that the model echoed;
 * 2. the English `term` itself (ignoring a "to " prefix the model may add);
 * 3. position, and only for Vietnamese rows, because those are the ones whose
 *    `term` cannot match what was sent, and the prompt asks for the same order.
 *
 * Nothing is matched twice: a suggestion already used for one row can never be
 * reused for another, so a 5-item batch can never produce two identical rows.
 */

export interface SuggestionPools {
  bySource: Map<string, AiSuggestion>;
  byTerm: Map<string, AiSuggestion>;
  byBare: Map<string, AiSuggestion>;
  list: AiSuggestion[];
}

/** Compare spelling the way the bank does: case, spacing and "to " aside. */
export function matchKey(term: string): string {
  // Groq sometimes prefixes a verb with "to " even when the learner did not.
  // Accept that spelling for matching, but keep the learner's own term when
  // saving so the bank does not silently acquire a duplicate variant.
  return normalizeTerm(term).replace(/^to\s+/, '');
}

export function buildSuggestionPools(suggestions: readonly AiSuggestion[]): SuggestionPools {
  const bySource = new Map<string, AiSuggestion>();
  const byTerm = new Map<string, AiSuggestion>();
  const byBare = new Map<string, AiSuggestion>();
  for (const suggestion of suggestions) {
    if (suggestion.sourceVi) bySource.set(normalizeTerm(suggestion.sourceVi), suggestion);
    byTerm.set(normalizeTerm(suggestion.term), suggestion);
    byBare.set(matchKey(suggestion.term), suggestion);
  }
  return { bySource, byTerm, byBare, list: [...suggestions] };
}

export function matchSuggestion(
  item: ParsedListItem,
  index: number,
  pools: SuggestionPools,
  claimed: ReadonlySet<AiSuggestion>,
): AiSuggestion | null {
  const normalized = normalizeTerm(item.value);
  const direct =
    pools.bySource.get(normalized) ??
    pools.byTerm.get(normalized) ??
    pools.byBare.get(matchKey(item.value));
  if (direct) return direct;

  // Positional fallback exists only for translated rows: their `term` is the
  // English translation, so it can never equal the Vietnamese that was sent.
  if (item.language !== 'vi') return null;
  const positional = pools.list[index];
  if (!positional || claimed.has(positional)) return null;
  // Trust the position only when the row either echoes our source or omits it.
  if (positional.sourceVi && normalizeTerm(positional.sourceVi) !== normalized) return null;
  return positional;
}

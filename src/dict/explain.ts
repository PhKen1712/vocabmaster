import type { AiSuggestion } from '../ai/types';
import { normalizeTerm, uniqueStrings } from '../lib/text';
import type { DictField } from './types';
import type { DictEntry } from './types';
import { computeMissing } from './lookup';

/**
 * Merge AI explanations into dictionary results for a pasted list.
 *
 * The AI writes the learner-facing Vietnamese meaning and simple English
 * definition, because dictionary glosses are often academic. Verified data
 * from the dictionary wins where it is better: IPA, audio and a part of speech
 * are kept when present. Every field the AI supplied is recorded in `aiFilled`
 * so the card can label it instead of pretending the dictionary said it.
 */
export function applyExplanations(
  entries: readonly DictEntry[],
  suggestions: readonly AiSuggestion[],
): DictEntry[] {
  const byTerm = new Map<string, AiSuggestion>();
  for (const suggestion of suggestions) {
    const term = normalizeTerm(suggestion.term);
    if (term && !byTerm.has(term)) byTerm.set(term, suggestion);
  }

  return entries.map((entry) => {
    const ai = byTerm.get(entry.normalized);
    if (!ai) return entry;

    const meaningVi = ai.meaningVi?.trim();
    if (!meaningVi) return entry;

    const filled = new Set<DictField>(entry.aiFilled);
    filled.add('meaningVi');
    if (ai.definitionEn?.trim()) filled.add('definitionEn');
    if (ai.exampleEn?.trim()) filled.add('exampleEn');

    // The dictionary's IPA is verified; only fall back to the model's IPA when
    // the dictionary had none and the model returned a properly wrapped one.
    const aiIpa = ai.ipa?.trim();
    const ipa = entry.ipa ?? (aiIpa && /^[/[].+[/\]]$/.test(aiIpa) ? aiIpa : null);
    if (!entry.ipa && ipa) filled.add('ipa');

    const merged: DictEntry = {
      ...entry,
      meaningVi,
      otherMeaningsVi:
        entry.meaningVi && entry.meaningVi !== meaningVi
          ? uniqueStrings([entry.meaningVi, ...entry.otherMeaningsVi]).slice(0, 4)
          : entry.otherMeaningsVi,
      definitionEn: ai.definitionEn?.trim() || entry.definitionEn,
      exampleEn: ai.exampleEn?.trim() || entry.exampleEn,
      partOfSpeech: entry.partOfSpeech || ai.partOfSpeech || null,
      ipa,
      synonyms: uniqueStrings([...entry.synonyms, ...(ai.synonyms ?? [])]),
      antonyms: uniqueStrings([...entry.antonyms, ...(ai.antonyms ?? [])]),
      // `gemini` is the historical source label; it now means "written by the
      // configured AI provider" (Groq or Gemini) and is shown as "AI".
      sources: [...new Set([...entry.sources, 'gemini' as const])],
      aiFilled: [...filled],
    };
    merged.missing = computeMissing(merged);
    return merged;
  });
}

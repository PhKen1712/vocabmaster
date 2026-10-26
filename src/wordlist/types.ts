import type { AiSuggestion } from '../ai/types';
import type { Level, WordField, WordInput } from '../types';
import { detectLanguage, type InputLanguage } from '../lib/lang';
import { normalizeTerm } from '../lib/text';

/**
 * One row of the pasted-list preview.
 *
 * Every field here is produced by Groq (never by a dictionary API). A row that
 * Groq could not explain is kept with `status: 'failed'` and an error, so the
 * learner sees exactly which items still need attention instead of having them
 * silently disappear.
 */
export interface ListEntry {
  /** The term that will be saved: English, including for translated rows. */
  term: string;
  /**
   * Row key. It is the item the learner typed — the Vietnamese text for a
   * translated row — so a retry or a re-run always addresses the same row.
   */
  normalized: string;
  /** Detected per item; a mixed list works because of this. */
  language: InputLanguage;
  /** The Vietnamese the learner typed, when Groq translated this row. */
  sourceTerm: string | null;
  /** English candidates for a translated row, best first. Empty otherwise. */
  englishOptions: string[];
  /** True when Groq said it was not sure about the translation. */
  uncertain: boolean;
  status: 'ready' | 'failed';
  meaningVi: string | null;
  ipa: string | null;
  partOfSpeech: string | null;
  definitionEn: string | null;
  exampleEn: string | null;
  exampleVi: string | null;
  synonyms: string[];
  antonyms: string[];
  collocations: string[];
  wordFamily: string[];
  topic: string | null;
  level: Level | null;
  levelSource: 'ai' | 'pack' | 'settings' | null;
  /** True when this row came from the on-device cache. */
  cached: boolean;
  error: string | null;
  missing: WordField[];
}

export function missingListFields(entry: Omit<ListEntry, 'missing'>): WordField[] {
  const missing: WordField[] = [];
  if (!entry.ipa) missing.push('ipa');
  if (!entry.partOfSpeech) missing.push('partOfSpeech');
  if (!entry.meaningVi) missing.push('meaningVi');
  if (!entry.definitionEn) missing.push('definitionEn');
  if (!entry.exampleEn) missing.push('exampleEn');
  if (entry.synonyms.length === 0) missing.push('synonyms');
  return missing;
}

export interface ListEntryExtras {
  level: Level | null;
  levelSource: ListEntry['levelSource'];
  cached: boolean;
  /** Row key when it differs from `term` (the Vietnamese the learner typed). */
  key?: string;
  language?: InputLanguage;
  /** Present when Groq turned a Vietnamese item into an English term. */
  translation?: { sourceTerm: string; englishOptions: string[]; uncertain: boolean } | null;
}

export function entryFromSuggestion(
  term: string,
  suggestion: AiSuggestion,
  extras: ListEntryExtras,
): ListEntry {
  const base: Omit<ListEntry, 'missing'> = {
    term,
    normalized: normalizeTerm(extras.key ?? term),
    language: extras.language ?? detectLanguage(term),
    sourceTerm: extras.translation?.sourceTerm ?? null,
    englishOptions: extras.translation?.englishOptions ?? [],
    uncertain: extras.translation?.uncertain ?? false,
    status: 'ready',
    meaningVi: suggestion.meaningVi?.trim() || null,
    ipa: suggestion.ipa?.trim() || null,
    partOfSpeech: suggestion.partOfSpeech?.trim() || null,
    definitionEn: suggestion.definitionEn?.trim() || null,
    exampleEn: suggestion.exampleEn?.trim() || null,
    exampleVi: suggestion.exampleVi?.trim() || null,
    synonyms: suggestion.synonyms ?? [],
    antonyms: suggestion.antonyms ?? [],
    collocations: suggestion.collocations ?? [],
    wordFamily: suggestion.wordFamily ?? [],
    topic: suggestion.topic?.trim() || null,
    level: extras.level,
    levelSource: extras.levelSource,
    cached: extras.cached,
    error: null,
  };
  return { ...base, missing: missingListFields(base) };
}

export function failedEntry(term: string, error: string): ListEntry {
  return {
    term,
    normalized: normalizeTerm(term),
    language: detectLanguage(term),
    sourceTerm: null,
    englishOptions: [],
    uncertain: false,
    status: 'failed',
    meaningVi: null,
    ipa: null,
    partOfSpeech: null,
    definitionEn: null,
    exampleEn: null,
    exampleVi: null,
    synonyms: [],
    antonyms: [],
    collocations: [],
    wordFamily: [],
    topic: null,
    level: null,
    levelSource: null,
    cached: false,
    error,
    missing: ['ipa', 'partOfSpeech', 'meaningVi', 'definitionEn', 'exampleEn', 'synonyms'],
  };
}

/** Convert a ready row into the same WordInput shape the AI studio uses. */
export function entryToWordInput(
  entry: ListEntry,
  options: { track: WordInput['track']; level: Level; topic: string },
): WordInput | null {
  if (entry.status !== 'ready' || !entry.meaningVi?.trim()) return null;
  return {
    term: entry.term,
    ipa: entry.ipa,
    partOfSpeech: entry.partOfSpeech,
    meaningVi: entry.meaningVi,
    definitionEn: entry.definitionEn,
    exampleEn: entry.exampleEn,
    exampleVi: entry.exampleVi,
    synonyms: entry.synonyms,
    antonyms: entry.antonyms,
    collocations: entry.collocations,
    wordFamily: entry.wordFamily,
    topic: entry.topic ?? (options.topic.trim() || null),
    track: options.track,
    level: entry.level ?? options.level,
    source: 'ai',
    aiGenerated: true,
    confirmed: true,
    // Keep the original Vietnamese next to the English term, so the learner can
    // still see what they typed after the row is saved.
    note: entry.sourceTerm ? `Gốc: ${entry.sourceTerm}` : null,
  };
}

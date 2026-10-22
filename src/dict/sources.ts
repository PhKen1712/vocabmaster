/**
 * The two dictionaries the app reads from, checked against the live services.
 *
 * 1. dict.minhqnd.com `/api/v1/lookup` — Vietnamese meanings for English
 *    headwords, IPA, a TTS audio URL and Vietnamese part-of-speech labels.
 *    Docs: https://dict.minhqnd.com · CC BY-SA 4.0 · attribution required ·
 *    CORS open · no API key.
 * 2. api.dictionaryapi.dev — English definitions, example sentences and
 *    synonyms from Wiktionary. CC BY-SA 3.0 · no API key.
 *
 * Verified live on 2026-10-22: `criminal`, `civil`, `justice`, `evidence` all
 * answer 200 on both. Unknown headwords answer 404 with `{exists:false}` on
 * minhqnd, but dictionaryapi.dev loses its 404 inside a Cloudflare tunnel and
 * sends **HTTP 530 with the plain-text body `error code: 1033`** instead (three
 * identical attempts). That status is treated as "not found" here, and the
 * comment stays so nobody "fixes" it into a retry loop.
 */

import type { DictSourceName, SourceResult } from './types';

export const MINHQND_BASE = 'https://dict.minhqnd.com';
export const MINHQND_ATTRIBUTION = 'dict.minhqnd.com (@minhqnd)';
export const WIKTIONARY_ATTRIBUTION = 'Wiktionary qua api.dictionaryapi.dev';

export function minhqndUrl(term: string): string {
  return `${MINHQND_BASE}/api/v1/lookup?word=${encodeURIComponent(term)}&lang=en`;
}

export function wiktionaryUrl(term: string): string {
  return `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(term)}`;
}

export interface SourceDefinition {
  name: DictSourceName;
  url: (term: string) => string;
  parse: (body: string, term: string) => SourceResult;
  /** HTTP statuses that mean "this dictionary does not know the word". */
  notFoundStatuses?: number[];
}

const VI_POS: [RegExp, string][] = [
  [/danh từ riêng/i, 'noun'],
  [/danh từ/i, 'noun'],
  [/động từ/i, 'verb'],
  [/tính từ/i, 'adjective'],
  [/trạng từ|phó từ/i, 'adverb'],
  [/thành ngữ|cụm từ|ngữ cố định/i, 'phrase'],
  [/giới từ/i, 'preposition'],
  [/liên từ/i, 'conjunction'],
  [/đại từ/i, 'pronoun'],
  [/thán từ/i, 'interjection'],
  [/mạo từ/i, 'article'],
  [/số từ/i, 'numeral'],
  [/từ viết tắt/i, 'abbreviation'],
];

export function partOfSpeechFromVietnamese(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.trim();
  if (!text) return null;
  for (const [pattern, english] of VI_POS) {
    if (pattern.test(text)) return english;
  }
  return null;
}

const IPA_MARKS = /[ˈˌəɪʊɛɔæʌθðʃʒŋɹɑɒɜːɐ]/;

/**
 * Keep only plausible IPA. Real `criminal` data contains `ʹsĭv-əl`-style
 * legacy respellings next to proper IPA, and those must not reach the UI.
 */
export function normalizeIpa(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.replace(/^["'“”]+|["'“”]+$/g, '').trim();
  if (!value) return null;
  if (/^\/.+\/$/.test(value)) return value.length > 2 ? value : null;
  if (/^\[.+\]$/.test(value)) return value;
  if (IPA_MARKS.test(value)) return `/${value}/`;
  return null;
}

export function containsTerm(sentence: string, term: string): boolean {
  const haystack = sentence.toLowerCase();
  const needle = term.trim().toLowerCase();
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, 'i').test(haystack);
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function unique(values: string[], exclude: string, limit = 8): string[] {
  const seen = new Set<string>([exclude.trim().toLowerCase()]);
  const result: string[] = [];
  for (const value of values) {
    const clean = value.replace(/\s+/g, ' ').trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
    if (result.length >= limit) break;
  }
  return result;
}

function empty(source: DictSourceName): SourceResult {
  return {
    source,
    found: false,
    ipa: null,
    audioUrl: null,
    partOfSpeech: null,
    meaningsVi: [],
    definitionsEn: [],
    exampleEn: null,
    synonyms: [],
    antonyms: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function absoluteMinhqnd(path: string): string | null {
  const value = path.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/')) return `${MINHQND_BASE}${value}`;
  return null;
}

/** `dict.minhqnd.com/api/v1/lookup` response → one normalized answer. */
export function parseMinhqnd(body: string, term: string): SourceResult {
  const result = empty('minhqnd');
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    result.error = { code: 'parse', message: 'minhqnd: JSON không hợp lệ.' };
    return result;
  }
  if (!isRecord(payload)) {
    result.error = { code: 'parse', message: 'minhqnd: phản hồi không phải object.' };
    return result;
  }
  if (payload.exists !== true) return result;

  const results = asArray(payload.results).filter(isRecord);
  const english = results.find((item) => asText(item.lang_code) === 'en') ?? results[0];
  if (!english) return result;

  const meanings = asArray(english.meanings).filter(isRecord);
  const meaningsVi: string[] = [];
  const definitionsEn: string[] = [];
  let example: string | null = null;
  let partOfSpeech: string | null = null;

  for (const meaning of meanings) {
    const definition = asText(meaning.definition);
    if (!definition) continue;
    const language = asText(meaning.definition_lang) || 'vi';
    if (language === 'vi') {
      if (!meaningsVi.some((item) => item.toLowerCase() === definition.toLowerCase())) {
        meaningsVi.push(definition);
      }
    } else if (language === 'en') {
      definitionsEn.push(definition);
    }

    if (!partOfSpeech) partOfSpeech = partOfSpeechFromVietnamese(asText(meaning.pos));

    const sample = asText(meaning.example);
    if (
      !example &&
      sample &&
      wordCount(sample) >= 3 &&
      containsTerm(sample, term)
    ) {
      example = sample;
    }
  }

  const pronunciations = asArray(english.pronunciations).filter(isRecord);
  let ipa: string | null = null;
  for (const pronunciation of pronunciations) {
    ipa = normalizeIpa(asText(pronunciation.ipa));
    if (ipa) break;
  }

  const relations = asArray(english.relations).filter(isRecord);
  const synonyms: string[] = [];
  const antonyms: string[] = [];
  for (const relation of relations) {
    const word = asText(relation.related_word);
    const type = asText(relation.relation_type);
    if (!word) continue;
    if (/đồng nghĩa/i.test(type)) synonyms.push(word);
    else if (/trái nghĩa/i.test(type)) antonyms.push(word);
  }

  return {
    ...result,
    found: true,
    ipa,
    audioUrl: absoluteMinhqnd(asText(english.audio)),
    partOfSpeech,
    meaningsVi,
    definitionsEn,
    exampleEn: example,
    synonyms: unique(synonyms, term),
    antonyms: unique(antonyms, term),
  };
}

/** `api.dictionaryapi.dev` response → one normalized answer. */
export function parseWiktionary(body: string, term: string): SourceResult {
  const result = empty('wiktionary');
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    result.error = { code: 'parse', message: 'dictionaryapi: JSON không hợp lệ.' };
    return result;
  }
  if (!Array.isArray(payload) || payload.length === 0) {
    // `{ title: "No Definitions Found" }` is the documented not-found body.
    return result;
  }

  const entries = payload.filter(isRecord);
  const definitionsEn: string[] = [];
  const synonyms: string[] = [];
  const antonyms: string[] = [];
  let ipa: string | null = null;
  let audioUrl: string | null = null;
  let partOfSpeech: string | null = null;
  let example: string | null = null;

  for (const entry of entries) {
    if (!ipa) ipa = normalizeIpa(asText(entry.phonetic));

    for (const phonetic of asArray(entry.phonetics).filter(isRecord)) {
      if (!ipa) ipa = normalizeIpa(asText(phonetic.text));
      const audio = asText(phonetic.audio);
      if (!audioUrl && audio) {
        audioUrl = audio.startsWith('//') ? `https:${audio}` : audio;
      }
    }

    for (const meaning of asArray(entry.meanings).filter(isRecord)) {
      const pos = asText(meaning.partOfSpeech);
      if (!partOfSpeech && pos) partOfSpeech = pos;

      for (const word of asArray(meaning.synonyms)) synonyms.push(asText(word));
      for (const word of asArray(meaning.antonyms)) antonyms.push(asText(word));

      for (const definition of asArray(meaning.definitions).filter(isRecord)) {
        const text = asText(definition.definition);
        if (text && !definitionsEn.includes(text)) definitionsEn.push(text);

        for (const word of asArray(definition.synonyms)) synonyms.push(asText(word));
        for (const word of asArray(definition.antonyms)) antonyms.push(asText(word));

        const sample = asText(definition.example);
        if (
          !example &&
          sample &&
          wordCount(sample) >= 3 &&
          containsTerm(sample, term)
        ) {
          example = sample;
        }
      }
    }
  }

  return {
    ...result,
    found: definitionsEn.length > 0 || Boolean(partOfSpeech),
    ipa,
    audioUrl,
    partOfSpeech,
    meaningsVi: [],
    definitionsEn: definitionsEn.slice(0, 6),
    exampleEn: example,
    synonyms: unique(synonyms, term),
    antonyms: unique(antonyms, term),
  };
}

export const MINHQND_SOURCE: SourceDefinition = {
  name: 'minhqnd',
  url: minhqndUrl,
  parse: parseMinhqnd,
  notFoundStatuses: [404],
};

export const WIKTIONARY_SOURCE: SourceDefinition = {
  name: 'wiktionary',
  url: wiktionaryUrl,
  parse: parseWiktionary,
  // 404 is the documented status; 530 is the observed Cloudflare leak.
  notFoundStatuses: [404, 530],
};

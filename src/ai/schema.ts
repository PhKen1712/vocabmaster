import { normalizeTerm, uniqueStrings } from '../lib/text';
import type { Level, Track } from '../types';
import type { AiParseResult, AiRequest, AiSuggestion } from './types';

/** Gemini responseSchema (OpenAPI subset) describing the JSON we accept. */
export const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    words: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          term: { type: 'STRING' },
          ipa: { type: 'STRING' },
          partOfSpeech: { type: 'STRING' },
          meaningVi: { type: 'STRING' },
          definitionEn: { type: 'STRING' },
          exampleEn: { type: 'STRING' },
          exampleVi: { type: 'STRING' },
          synonyms: { type: 'ARRAY', items: { type: 'STRING' } },
          antonyms: { type: 'ARRAY', items: { type: 'STRING' } },
          collocations: { type: 'ARRAY', items: { type: 'STRING' } },
          wordFamily: { type: 'ARRAY', items: { type: 'STRING' } },
          topic: { type: 'STRING' },
          level: { type: 'INTEGER' },
          rationale: { type: 'STRING' },
        },
        required: ['term', 'meaningVi', 'partOfSpeech', 'level'],
      },
    },
  },
  required: ['words'],
} as const;

function asString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(
    value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length > 0 && item.length <= 120)
      .slice(0, 12),
  );
}

function asLevel(value: unknown, fallback: Level): Level {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  if (rounded < 0) return 0;
  if (rounded > 6) return 6;
  return rounded as Level;
}

function isLikelyIpa(value: string): boolean {
  // IPA must be wrapped in slashes or brackets; otherwise store nothing rather
  // than showing an invented pronunciation.
  return /^[/[].+[/\]]$/.test(value);
}

/**
 * Parse untrusted model output.
 *
 * Every rejected item is reported with a reason instead of being silently
 * dropped, and nothing is written to the database here: the UI shows a preview
 * that the learner must confirm.
 */
export function parseSuggestions(raw: unknown, request: AiRequest): AiParseResult {
  const rejected: string[] = [];
  const suggestions: AiSuggestion[] = [];
  const seen = new Set<string>(request.avoidTerms.map((term) => normalizeTerm(term)));

  if (!raw || typeof raw !== 'object') {
    return { suggestions: [], rejected: ['Gemini không trả về JSON object.'] };
  }

  const words = (raw as { words?: unknown }).words;
  if (!Array.isArray(words)) {
    return { suggestions: [], rejected: ['Thiếu trường "words" trong phản hồi.'] };
  }

  for (const [index, item] of words.entries()) {
    if (!item || typeof item !== 'object') {
      rejected.push(`Mục ${index + 1}: không phải object.`);
      continue;
    }
    const record = item as Record<string, unknown>;
    const term = asString(record.term, 80);
    const meaningVi = asString(record.meaningVi, 240);
    const partOfSpeech = asString(record.partOfSpeech, 40);

    if (!term) {
      rejected.push(`Mục ${index + 1}: thiếu từ tiếng Anh.`);
      continue;
    }
    if (!meaningVi) {
      rejected.push(`"${term}": thiếu nghĩa tiếng Việt.`);
      continue;
    }

    const key = normalizeTerm(term);
    if (seen.has(key)) {
      rejected.push(`"${term}": trùng với từ đã có hoặc trùng trong cùng bộ.`);
      continue;
    }
    seen.add(key);

    const exampleEn = asString(record.exampleEn, 400);
    const exampleVi = asString(record.exampleVi, 400);
    const definitionEn = asString(record.definitionEn, 400);
    const ipaRaw = asString(record.ipa, 80);
    const topic = asString(record.topic, 80) ?? request.topic?.trim() ?? null;

    const track: Track = request.track;
    suggestions.push({
      term,
      meaningVi,
      partOfSpeech: partOfSpeech ?? 'phrase',
      ipa: ipaRaw && isLikelyIpa(ipaRaw) ? ipaRaw : null,
      definitionEn: definitionEn ?? null,
      exampleEn: exampleEn ?? null,
      exampleVi: exampleVi ?? null,
      synonyms: asStringArray(record.synonyms),
      antonyms: asStringArray(record.antonyms),
      collocations: asStringArray(record.collocations),
      wordFamily: asStringArray(record.wordFamily),
      topic,
      track,
      level: asLevel(record.level, request.level),
      source: 'ai',
      aiGenerated: true,
      confirmed: false,
      rationale: asString(record.rationale, 240),
    });
  }

  return { suggestions, rejected };
}

/** Extract the JSON object from a text response, tolerating code fences. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

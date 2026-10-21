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

/** Part-of-speech labels the app understands, after light normalisation. */
const PART_OF_SPEECH = new Set([
  'noun',
  'verb',
  'adjective',
  'adverb',
  'phrase',
  'idiom',
  'phrasal verb',
  'preposition',
  'conjunction',
  'pronoun',
  'determiner',
  'interjection',
  'modal verb',
  'auxiliary verb',
  'number',
]);

const POS_ALIASES: Record<string, string> = {
  adj: 'adjective',
  adv: 'adverb',
  n: 'noun',
  v: 'verb',
  'phrasal-verb': 'phrasal verb',
  phrasal: 'phrasal verb',
  expression: 'phrase',
  'noun phrase': 'phrase',
  'verb phrase': 'phrase',
};

function asString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
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

function asLevel(value: unknown): Level | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded < 0) return 0;
  if (rounded > 6) return 6;
  return rounded as Level;
}

function normalizePartOfSpeech(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value.toLowerCase().replace(/\.$/, '').trim();
  if (!cleaned) return null;
  return POS_ALIASES[cleaned] ?? cleaned;
}

function isLikelyIpa(value: string): boolean {
  // IPA must be wrapped in slashes or brackets; otherwise store nothing rather
  // than showing an invented pronunciation.
  return /^[/[].+[/\]]$/.test(value);
}

function mentionsTerm(example: string, term: string): boolean {
  const needle = term.replace(/^to\s+/i, '').toLowerCase();
  if (!needle) return true;
  const haystack = example.toLowerCase();
  if (haystack.includes(needle)) return true;
  // Allow simple inflections ("maintain" → "maintained", "study" → "studies").
  const stem = needle.replace(/(e|y)$/, '');
  return stem.length >= 4 && haystack.includes(stem);
}

/** True when the JSON we received was cut off before its final brace. */
export function looksTruncated(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && !trimmed.endsWith('}');
}

/**
 * Salvage complete items from a response cut off by the token limit.
 * Returns null unless a usable `words` array can be recovered.
 */
export function repairTruncatedJson(text: string): unknown {
  const start = text.indexOf('{');
  if (start < 0) return null;
  const body = text.slice(start);
  const closes: number[] = [];
  for (let index = body.length - 1; index >= 0 && closes.length < 40; index -= 1) {
    if (body[index] === '}') closes.push(index);
  }
  for (const index of closes) {
    const prefix = body.slice(0, index + 1);
    for (const suffix of ['', '}', ']}']) {
      try {
        const parsed = JSON.parse(prefix + suffix) as { words?: unknown };
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.words)) return parsed;
      } catch {
        // Try a shorter prefix / different closing suffix.
      }
    }
  }
  return null;
}

/**
 * Parse untrusted model output.
 *
 * Every rejected item is reported with a reason instead of being silently
 * dropped, suspicious-but-usable fields become warnings, and nothing is written
 * to the database here: the UI shows a preview the learner must confirm.
 */
export function parseSuggestions(raw: unknown, request: AiRequest): AiParseResult {
  const rejected: string[] = [];
  const warnings: string[] = [];
  const suggestions: AiSuggestion[] = [];
  const seen = new Set<string>(request.avoidTerms.map((term) => normalizeTerm(term)));

  if (!raw || typeof raw !== 'object') {
    return { suggestions: [], rejected: ['Gemini không trả về JSON object.'], warnings: [] };
  }

  const words = (raw as { words?: unknown }).words;
  if (!Array.isArray(words)) {
    return { suggestions: [], rejected: ['Thiếu trường "words" trong phản hồi.'], warnings: [] };
  }

  for (const [index, item] of words.entries()) {
    if (!item || typeof item !== 'object') {
      rejected.push(`Mục ${index + 1}: không phải object.`);
      continue;
    }
    const record = item as Record<string, unknown>;
    const term = asString(record.term, 80);
    const meaningVi = asString(record.meaningVi, 240);
    const partOfSpeechRaw = asString(record.partOfSpeech, 40);

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

    const partOfSpeech = normalizePartOfSpeech(partOfSpeechRaw);
    if (partOfSpeech && !PART_OF_SPEECH.has(partOfSpeech)) {
      warnings.push(`"${term}": từ loại "${partOfSpeech}" chưa chuẩn — kiểm tra lại trước khi thêm.`);
    }

    let ipa: string | null = null;
    if (ipaRaw) {
      if (isLikelyIpa(ipaRaw)) {
        ipa = ipaRaw;
      } else {
        warnings.push(`"${term}": IPA "${ipaRaw}" không đúng dạng /…/ nên không được lưu.`);
      }
    }

    const aiLevel = asLevel(record.level);
    const level = aiLevel ?? request.level;
    if (!request.lookupTerm && aiLevel !== null && Math.abs(aiLevel - request.level) >= 2) {
      warnings.push(
        `"${term}": Gemini gắn cấp độ ${aiLevel} nhưng bạn chọn ${request.level} — có thể khó hơn mong đợi.`,
      );
    }

    if (exampleEn && !mentionsTerm(exampleEn, term)) {
      warnings.push(`"${term}": câu ví dụ có thể không chứa từ này.`);
    }
    if (normalizeTerm(meaningVi) === key) {
      warnings.push(`"${term}": nghĩa tiếng Việt giống hệt từ tiếng Anh, có thể chưa được dịch.`);
    }

    const track: Track = request.track;
    suggestions.push({
      term,
      meaningVi,
      partOfSpeech: partOfSpeech ?? 'phrase',
      ipa,
      definitionEn: definitionEn ?? null,
      exampleEn: exampleEn ?? null,
      exampleVi: exampleVi ?? null,
      synonyms: asStringArray(record.synonyms),
      antonyms: asStringArray(record.antonyms),
      collocations: asStringArray(record.collocations),
      wordFamily: asStringArray(record.wordFamily),
      topic,
      track,
      level,
      source: 'ai',
      aiGenerated: true,
      confirmed: false,
      rationale: asString(record.rationale, 240),
    });
  }

  return { suggestions, rejected, warnings };
}

/** Extract the JSON object from a text response, tolerating fences and truncation. */
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
        return repairTruncatedJson(trimmed);
      }
    }
    return repairTruncatedJson(trimmed);
  }
}

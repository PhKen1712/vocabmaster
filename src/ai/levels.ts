import { normalizeTerm } from '../lib/text';
import type { AiProvider, Level } from '../types';
import { defaultModel, normalizeModel, requestGeminiJson } from './gemini';
import { defaultGroqModel, normalizeGroqModel, requestGroqJson } from './groq';
import { loadProviderKey, providerLabel } from './provider';
import { extractJson } from './schema';

/**
 * CEFR level estimation for a pasted word list.
 *
 * The learner pastes words they already chose, so asking them to pick one level
 * for the whole list is wrong: "water" and "unprecedented" do not belong in the
 * same band. This asks the model once for the whole list, which costs a single
 * request instead of one per word.
 *
 * The estimate is advisory: every caller must keep working when this fails
 * (no key, network down, unreadable answer) and must show that the level was an
 * estimate rather than something the learner chose.
 */

const MAX_TERMS = 50;

const LEVEL_SCALE = [
  '0 = pre-A1 (absolute beginner: water, eat, happy)',
  '1 = A1 (survival: borrow, ticket, hungry)',
  '2 = A2 (everyday: improve, schedule, prefer)',
  '3 = B1 (comfortable: achieve, benefit, reduce)',
  '4 = B2 (confident/abstract: assess, consequence, maintain)',
  '5 = C1 (advanced: ambiguous, undermine, comprehensive)',
  '6 = C2 (specialist/rare: undeniable, nuance, meticulous)',
].join('\n');

function buildLevelPrompt(terms: string[]): string {
  return [
    'Rate the CEFR level of each English item below, as a learner would meet it in General English or IELTS.',
    'Judge the item itself, not a sentence: "water" is 0 even though it is common in C2 writing.',
    'Phrases and idioms take the level of the whole expression.',
    'Levels:',
    LEVEL_SCALE,
    '',
    'Items:',
    ...terms.map((term, index) => `${index + 1}. ${term}`),
    '',
    'Return valid JSON only, no markdown, no commentary, one entry per item, using the item exactly as written:',
    '{"levels":[{"term":"water","level":0}]}',
  ].join('\n');
}

const LEVEL_SYSTEM =
  'You are a CEFR vocabulary expert. You assign the level of a word as it appears ' +
  'in a frequency-informed learner dictionary, not the level of the learner. ' +
  'When unsure, choose the lower band rather than guessing a rare label. Respond with JSON only.';

export interface LevelEstimate {
  /** Keyed by `normalizeTerm(term)`, so it matches `DictEntry.normalized`. */
  levels: Map<string, Level>;
  /** Human sentence explaining why some levels are missing, if they are. */
  error: string | null;
}

export interface LevelEstimateOptions {
  provider: AiProvider;
  model: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Read only the entries we asked about, with an integer level in range. */
export function parseLevels(raw: unknown, terms: string[]): Map<string, Level> {
  const wanted = new Set(terms.map((term) => normalizeTerm(term)));
  const levels = new Map<string, Level>();
  if (!raw || typeof raw !== 'object') return levels;

  const list = (raw as { levels?: unknown }).levels;
  if (!Array.isArray(list)) return levels;

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const term = typeof record.term === 'string' ? normalizeTerm(record.term) : '';
    if (!term || !wanted.has(term)) continue;
    const value = typeof record.level === 'number' ? record.level : Number(record.level);
    if (!Number.isFinite(value)) continue;
    const rounded = Math.round(value);
    if (rounded < 0 || rounded > 6) continue;
    levels.set(term, rounded as Level);
  }
  return levels;
}

export async function estimateLevels(
  terms: string[],
  options: LevelEstimateOptions,
): Promise<LevelEstimate> {
  const unique = [...new Set(terms.map((term) => term.trim()).filter(Boolean))].slice(0, MAX_TERMS);
  if (unique.length === 0) return { levels: new Map(), error: null };

  const apiKey = await loadProviderKey(options.provider);
  if (!apiKey) {
    return {
      levels: new Map(),
      error: `Chưa có ${providerLabel(options.provider)} API key nên app chưa xác định được cấp độ cho từng từ.`,
    };
  }

  const model =
    options.provider === 'groq'
      ? normalizeGroqModel(options.model) || defaultGroqModel()
      : normalizeModel(options.model) || defaultModel();
  const maxTokens = Math.min(3_000, 300 + unique.length * 40);
  const shared = {
    apiKey,
    model,
    system: LEVEL_SYSTEM,
    user: buildLevelPrompt(unique),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  };

  try {
    const text =
      options.provider === 'groq'
        ? await requestGroqJson({ ...shared, maxCompletionTokens: maxTokens })
        : await requestGeminiJson({ ...shared, maxOutputTokens: maxTokens });

    const parsed = extractJson(text);
    if (parsed === null) {
      return {
        levels: new Map(),
        error: `${providerLabel(options.provider)} trả lời nhưng không đọc được JSON cấp độ.`,
      };
    }
    const levels = parseLevels(parsed, unique);
    return {
      levels,
      error:
        levels.size === 0
          ? `${providerLabel(options.provider)} không trả về cấp độ nào dùng được.`
          : null,
    };
  } catch (error) {
    if (options.signal?.aborted) return { levels: new Map(), error: null };
    return {
      levels: new Map(),
      error:
        error instanceof Error && error.message
          ? `Chưa xác định được cấp độ: ${error.message}`
          : 'Chưa xác định được cấp độ cho danh sách này.',
    };
  }
}

/**
 * Types for the dictionary lookup pipeline. This folder is pure TypeScript on
 * purpose: no React Native and no global `fetch` at import time, so every rule
 * below can be unit-tested with a fake HTTP client.
 */

import type { Level, WordField } from '../types';

/** Where a field really came from. Shown to the learner, never hidden. */
export type DictSourceName = 'minhqnd' | 'wiktionary' | 'gemini';

/** Fields the app wants for a word. Every entry reports what it could not get. */
export type DictField = WordField;

export const DICT_FIELD_LABELS: Record<DictField, string> = {
  ipa: 'phiên âm IPA',
  audio: 'audio phát âm',
  partOfSpeech: 'từ loại',
  meaningVi: 'nghĩa tiếng Việt',
  definitionEn: 'định nghĩa tiếng Anh',
  exampleEn: 'ví dụ tiếng Anh',
  synonyms: 'từ đồng nghĩa',
};

export type DictErrorCode =
  | 'not_found'
  | 'network'
  | 'timeout'
  | 'rate_limited'
  | 'server'
  | 'http'
  | 'parse';

export interface DictError {
  code: DictErrorCode;
  message: string;
  /** HTTP status when the failure came from a response. */
  status?: number;
  /** Milliseconds the server asked us to wait (Retry-After). */
  retryAfterMs?: number;
}

/** Errors worth a second request. A 404 or a bad payload is never retried. */
export const RETRYABLE_DICT_ERRORS: ReadonlySet<DictErrorCode> = new Set<DictErrorCode>([
  'network',
  'timeout',
  'rate_limited',
  'server',
]);

/** One dictionary's answer for one headword, already normalized. */
export interface SourceResult {
  source: DictSourceName;
  /** False when the dictionary answered "no such headword". */
  found: boolean;
  ipa: string | null;
  audioUrl: string | null;
  partOfSpeech: string | null;
  meaningsVi: string[];
  /** English-only definitions, used when the Vietnamese side has none. */
  definitionsEn: string[];
  exampleEn: string | null;
  synonyms: string[];
  antonyms: string[];
  /** Set when the request could not be completed at all. */
  error?: DictError;
  /** True when this answer came from the local cache, not the network. */
  cached?: boolean;
}

export interface DictEntry {
  /** The term as the learner typed it. */
  term: string;
  normalized: string;
  status: 'found' | 'notFound' | 'failed';
  ipa: string | null;
  audioUrl: string | null;
  partOfSpeech: string | null;
  meaningVi: string | null;
  /** Extra Vietnamese senses, shown as a preview so nothing is thrown away. */
  otherMeaningsVi: string[];
  definitionEn: string | null;
  exampleEn: string | null;
  synonyms: string[];
  antonyms: string[];
  /**
   * CEFR band the app worked out for this word, and where it came from.
   * `pack` = bundled word list (free, instant), `ai` = one batch estimate.
   * Null means nobody could tell: the UI must say so instead of pretending.
   */
  level: Level | null;
  levelSource: 'pack' | 'ai' | null;
  /** Dictionaries that answered this word. */
  sources: DictSourceName[];
  /** Fields filled by Gemini because the dictionaries had nothing for them. */
  aiFilled: DictField[];
  /** Fields still missing after every source was tried. */
  missing: DictField[];
  /** True when at least one source answered from the on-device cache. */
  cached: boolean;
  error?: DictError;
  attempts: number;
  elapsedMs: number;
}

export interface DictCache {
  get(key: string): Promise<{ value: unknown; fetchedAt: number } | null>;
  set(key: string, value: unknown, fetchedAt: number): Promise<void>;
}

export interface HttpResult {
  status: number;
  body: string;
  /** Lowercase header names. */
  headers: Record<string, string>;
}

export type HttpClient = (url: string, init?: { signal?: AbortSignal }) => Promise<HttpResult>;

/** Human sentence for a failed word, used by the UI. */
export function describeDictError(error: DictError | undefined): string {
  if (!error) return 'Không tra được từ này.';
  switch (error.code) {
    case 'not_found':
      return 'Không tìm thấy trong từ điển.';
    case 'network':
      return 'Mất kết nối khi tra từ điển.';
    case 'timeout':
      return 'Từ điển phản hồi quá lâu.';
    case 'rate_limited':
      return 'Từ điển đang giới hạn số lần gọi. Chờ một lát rồi thử lại.';
    case 'server':
      return 'Từ điển đang lỗi tạm thời.';
    case 'parse':
      return 'Từ điển trả về dữ liệu không đọc được.';
    default:
      return `Từ điển trả về lỗi ${error.status ?? ''}`.trim();
  }
}

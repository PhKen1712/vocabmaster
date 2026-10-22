import type { Level, Track, WordInput } from '../types';

export interface AiRequest {
  track: Track;
  level: Level;
  topic?: string | null;
  count: number;
  focus?: string | null;
  /** When set, Gemini explains this exact term instead of choosing new ones. */
  lookupTerm?: string | null;
  /** Terms already in the local database, sent so Gemini avoids duplicates. */
  avoidTerms: string[];
  /** Words the learner frequently gets wrong, for targeted practice. */
  weakTerms: string[];
}

export interface AiSuggestion extends WordInput {
  /** Short note explaining why the word is useful, shown in the preview card. */
  rationale?: string | null;
}

export interface AiParseResult {
  suggestions: AiSuggestion[];
  /** Items that could not be used at all, each with a reason. */
  rejected: string[];
  /**
   * Items that were kept but had a suspicious field (bad IPA shape, part of
   * speech outside the known list, example that does not contain the term…).
   * Shown to the learner so nothing looks silently verified.
   */
  warnings: string[];
}

export interface AiResult {
  suggestions: AiSuggestion[];
  rejected: string[];
  warnings: string[];
  model: string;
  /**
   * Set when the configured model was retired and Gemini ran with another
   * model instead, so the UI can explain the switch.
   */
  fallbackFrom?: string | null;
  /**
   * Why another model ran: `retired` when Google stopped serving the configured
   * one, `overloaded` when it returned 503/429 and another model answered.
   */
  fallbackReason?: 'retired' | 'overloaded' | null;
  /** True when Gemini returned nothing parseable. */
  empty: boolean;
  /** How many words the learner asked for, to report a shortfall honestly. */
  requested: number;
  /** How many HTTP calls were made (1 = no retry). */
  attempts: number;
  elapsedMs: number;
}

/**
 * Internal error codes. They are mapped from what Gemini actually returns
 * (see `errors.ts`); Gemini itself never sends these names.
 *
 * invalid_key          ← INVALID_API_KEY
 * quota_exceeded       ← QUOTA_EXCEEDED
 * model_unavailable    ← MODEL_UNAVAILABLE
 * network              ← NETWORK_ERROR
 * timeout              ← REQUEST_TIMEOUT
 * rate_limited         ← RATE_LIMITED
 * invalid_response     ← INVALID_RESPONSE
 * json_parse           ← JSON_PARSE_ERROR
 * validation           ← VALIDATION_ERROR
 * database             ← DATABASE_ERROR
 * unknown              ← UNKNOWN_ERROR
 *
 * `missing_key`, `busy` and `cancelled` are app-side states, not API failures.
 */
export type AiErrorCode =
  | 'missing_key'
  | 'invalid_key'
  | 'quota_exceeded'
  | 'rate_limited'
  | 'network'
  | 'timeout'
  | 'server'
  | 'model_unavailable'
  | 'invalid_response'
  | 'json_parse'
  | 'validation'
  | 'database'
  | 'busy'
  | 'cancelled'
  | 'unknown';

/** Where in the pipeline a failure happened, for the diagnostics screen. */
export type AiStage = 'config' | 'request' | 'response' | 'parse' | 'validate' | 'save';

/** Errors worth another attempt without changing anything the user did. */
export const RETRYABLE_CODES: ReadonlySet<AiErrorCode> = new Set<AiErrorCode>([
  'network',
  'timeout',
  'server',
  'rate_limited',
]);

/** Errors caused by unusable model output: retried only once, then reported. */
export const OUTPUT_CODES: ReadonlySet<AiErrorCode> = new Set<AiErrorCode>([
  'json_parse',
  'invalid_response',
]);

export interface AiErrorOptions {
  httpStatus?: number;
  /** Milliseconds the server asked us to wait (Retry-After). */
  retryAfterMs?: number;
  stage?: AiStage;
  /** Technical detail for the diagnostics panel, never a secret. */
  detail?: string;
}

export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly httpStatus?: number;
  readonly retryAfterMs?: number;
  readonly stage?: AiStage;
  readonly detail?: string;

  constructor(code: AiErrorCode, message: string, options: AiErrorOptions = {}) {
    super(message);
    this.name = 'AiError';
    this.code = code;
    if (options.httpStatus !== undefined) this.httpStatus = options.httpStatus;
    if (options.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs;
    if (options.stage !== undefined) this.stage = options.stage;
    if (options.detail !== undefined) this.detail = options.detail;
  }

  /** Kept as a property-like getter so it can never drift from the code. */
  get retryable(): boolean {
    return RETRYABLE_CODES.has(this.code);
  }
}

/** Short fallback sentences. The UI prefers `describeAiError` for detail. */
export const AI_ERROR_MESSAGES: Record<AiErrorCode, string> = {
  missing_key: 'Chưa có Gemini API key. Vào Cài đặt để thêm key.',
  invalid_key: 'Gemini từ chối API key này. Kiểm tra lại key trong Cài đặt.',
  quota_exceeded: 'Key này đã hết hạn mức Gemini. Kiểm tra hạn mức hoặc thử lại sau.',
  rate_limited: 'Gửi quá nhanh. Chờ vài giây rồi thử lại.',
  network: 'Không kết nối được tới Gemini. Kiểm tra mạng rồi thử lại.',
  timeout: 'Gemini phản hồi quá lâu. Thử lại với ít từ hơn.',
  server: 'Gemini đang gặp lỗi tạm thời. Thử lại sau.',
  model_unavailable: 'Model Gemini đang chọn không còn khả dụng.',
  invalid_response: 'Gemini trả về nội dung không dùng được. Không có từ nào được lưu.',
  json_parse: 'Không đọc được JSON trong phản hồi Gemini.',
  validation: 'Yêu cầu gửi Gemini không hợp lệ.',
  database: 'Không lưu được từ vào máy.',
  busy: 'Đang có một lần tạo bộ từ khác chạy.',
  cancelled: 'Đã huỷ yêu cầu.',
  unknown: 'Không tạo được từ bằng Gemini. Bạn vẫn có thể thêm từ thủ công.',
};

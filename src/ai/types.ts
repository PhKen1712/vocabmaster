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
  rejected: string[];
}

export interface AiResult {
  suggestions: AiSuggestion[];
  rejected: string[];
  model: string;
  /**
   * Set when the configured model was retired and Gemini ran with another
   * model instead, so the UI can explain the switch.
   */
  fallbackFrom?: string | null;
  /** True when Gemini returned nothing parseable. */
  empty: boolean;
}

export type AiErrorCode =
  | 'missing_key'
  | 'invalid_key'
  | 'rate_limited'
  | 'network'
  | 'server'
  | 'invalid_response'
  | 'model_unavailable'
  | 'unknown';

export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly retryable: boolean;

  constructor(code: AiErrorCode, message: string, retryable = false) {
    super(message);
    this.name = 'AiError';
    this.code = code;
    this.retryable = retryable;
  }
}

export const AI_ERROR_MESSAGES: Record<AiErrorCode, string> = {
  missing_key: 'Chưa có Gemini API key. Vào Cài đặt để thêm key.',
  invalid_key: 'Gemini API key không hợp lệ hoặc chưa bật Gemini API cho key này.',
  rate_limited: 'Đã chạm giới hạn tần suất của Gemini. Thử lại sau ít phút.',
  network: 'Không kết nối được tới Gemini. Kiểm tra mạng rồi thử lại.',
  server: 'Gemini đang gặp lỗi tạm thời. Thử lại sau.',
  invalid_response: 'Gemini trả về dữ liệu không đúng định dạng. Không có từ nào được lưu.',
  model_unavailable:
    'Model Gemini đang chọn không còn khả dụng. Vào Cài đặt → Gemini AI, bấm "Kiểm tra key + model" rồi chọn model mới.',
  unknown: 'Không tạo được từ bằng Gemini. Bạn vẫn có thể thêm từ thủ công.',
};

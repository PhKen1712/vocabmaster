import { AiError, type AiErrorCode, type AiStage } from './types';

/**
 * Normalising whatever the network/API gave us into one of our own codes.
 *
 * Everything here is derived from what Gemini or `fetch` really returns: an
 * HTTP status, `error.status` (`INVALID_ARGUMENT`, `RESOURCE_EXHAUSTED`…), a
 * human message, sometimes a Retry-After header, sometimes quota ids. We never
 * assume Gemini sends our vocabulary.
 */

const INVALID_KEY = /api key not valid|api_key_invalid|invalid api key|api key expired|api key is invalid|key not valid/i;
const DAILY_QUOTA = /per.?day|per_day|daily|requestsperday|free_tier/i;
const PER_MINUTE = /per.?minute|per_minute|rate.?limit|too many requests|try again in/i;
const MODEL_GONE = /no longer available|not found|is not supported|does not exist|unknown model/i;
const BLOCKED_KEY = /api_key_service_blocked|api key.*blocked|permission_denied.*key/i;

/** Milliseconds from an HTTP Retry-After header (seconds or a date). */
export function parseRetryAfter(header: string | null | undefined): number | null {
  if (!header) return null;
  const value = header.trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const at = Date.parse(value);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - Date.now());
}

/** Strip anything that looks like a credential before it reaches a log or UI. */
export function redactSecrets(text: string): string {
  return text
    .replace(/AIza[0-9A-Za-z_-]{10,}/g, 'AIza…')
    .replace(/("?x-goog-api-key"?\s*[:=]\s*")[^"]+/gi, '$1***')
    .replace(/([?&]key=)[^&\s]+/gi, '$1***');
}

export interface HttpFailureInput {
  status: number;
  /** `error.message` from Gemini. */
  message?: string;
  /** `error.status`, e.g. RESOURCE_EXHAUSTED. */
  statusLabel?: string;
  /** Quota ids / violations extracted from `error.details`, when present. */
  quotaHint?: string;
  retryAfterMs?: number | null;
  stage?: AiStage;
}

export function errorFromHttp(input: HttpFailureInput): AiError {
  const { status } = input;
  const message = redactSecrets((input.message ?? '').trim());
  const label = input.statusLabel ?? '';
  const haystack = `${label} ${message} ${input.quotaHint ?? ''}`;

  if (INVALID_KEY.test(haystack) || BLOCKED_KEY.test(haystack)) {
    return new AiError('invalid_key', message || 'Gemini từ chối API key này.', {
      httpStatus: status,
      stage: input.stage ?? 'request',
    });
  }
  if (status === 401) {
    return new AiError('invalid_key', message || 'API key không hợp lệ hoặc đã bị thu hồi.', {
      httpStatus: status,
      stage: input.stage ?? 'request',
    });
  }
  if (status === 403) {
    return new AiError(
      'invalid_key',
      message || 'Key này không được phép dùng Gemini API. Kiểm tra key và quyền của project.',
      { httpStatus: status, stage: input.stage ?? 'request' },
    );
  }
  if (status === 404 || (status === 400 && MODEL_GONE.test(haystack))) {
    return new AiError('model_unavailable', message || 'Model Gemini không tồn tại.', {
      httpStatus: status,
      stage: input.stage ?? 'request',
    });
  }
  if (status === 429) {
    const retryAfterMs = input.retryAfterMs ?? null;
    if (retryAfterMs !== null || PER_MINUTE.test(haystack)) {
      return new AiError(
        'rate_limited',
        message || 'Gemini giới hạn số lần gọi mỗi phút.',
        {
          httpStatus: status,
          retryAfterMs: retryAfterMs ?? undefined,
          stage: input.stage ?? 'request',
        },
      );
    }
    if (DAILY_QUOTA.test(haystack)) {
      return new AiError('quota_exceeded', message || 'Đã dùng hết hạn mức miễn phí của key.', {
        httpStatus: status,
        stage: input.stage ?? 'request',
      });
    }
    // 429 with no hint: do not silently retry, it may be a daily cap that would
    // keep failing. Report the quota, which covers both per-minute and daily.
    return new AiError('quota_exceeded', message || 'Key này đã chạm hạn mức Gemini.', {
      httpStatus: status,
      stage: input.stage ?? 'request',
    });
  }
  if (status === 408) {
    return new AiError('timeout', message || 'Gemini phản hồi quá lâu.', {
      httpStatus: status,
      stage: input.stage ?? 'request',
    });
  }
  if (status === 400) {
    return new AiError('validation', message || 'Gemini từ chối nội dung yêu cầu.', {
      httpStatus: status,
      stage: input.stage ?? 'request',
    });
  }
  if (status >= 500) {
    return new AiError('server', message || 'Máy chủ Gemini tạm thời lỗi.', {
      httpStatus: status,
      stage: input.stage ?? 'request',
    });
  }
  return new AiError(
    'unknown',
    message ? `Gemini trả về lỗi ${status}: ${message}` : `Gemini trả về lỗi ${status}.`,
    { httpStatus: status, stage: input.stage ?? 'request' },
  );
}

export function toAiError(error: unknown, stage?: AiStage): AiError {
  if (error instanceof AiError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new AiError('unknown', redactSecrets(message) || 'Lỗi không xác định.', { stage });
}

export interface AiErrorView {
  code: AiErrorCode;
  title: string;
  body: string;
  /** Second line: what to do next. */
  hint?: string;
  /** Safe to offer a "Thử lại" button. */
  canRetry: boolean;
  /** Short technical line: `JSON_PARSE_ERROR · HTTP 200 · model …`. */
  diagnostic: string;
}

function technicalLine(error: AiError): string {
  const parts = [error.code.toUpperCase()];
  if (error.httpStatus !== undefined) parts.push(`HTTP ${error.httpStatus}`);
  if (error.stage) parts.push(error.stage);
  return parts.join(' · ');
}

/**
 * Turn an error into something a learner can act on, without ever showing the
 * API key or a raw stack trace.
 */
export function describeAiError(error: unknown): AiErrorView {
  const failure = toAiError(error);
  const diagnostic = technicalLine(failure);
  const google = redactSecrets(failure.message).slice(0, 320);

  switch (failure.code) {
    case 'missing_key':
      return {
        code: failure.code,
        title: 'Chưa có API key',
        body: 'Ứng dụng chưa có Gemini API key nên không thể tạo bộ từ.',
        hint: 'Mở Cài đặt → Gemini AI, dán key lấy từ Google AI Studio rồi bấm "Lưu key".',
        canRetry: false,
        diagnostic,
      };
    case 'invalid_key':
      return {
        code: failure.code,
        title: 'Key bị Google từ chối',
        body: google || 'Gemini không chấp nhận key này.',
        hint: 'Kiểm tra key còn hiệu lực và đã bật Generative Language API. Dán key mới trong Cài đặt → Gemini AI.',
        canRetry: false,
        diagnostic,
      };
    case 'quota_exceeded':
      return {
        code: failure.code,
        title: 'Đã hết hạn mức Gemini',
        body: google || 'Key này đã dùng hết hạn mức miễn phí hiện tại.',
        hint: 'Hạn mức có thể theo phút hoặc theo ngày. Chờ vài phút rồi thử lại, hoặc giảm số từ cần tạo.',
        canRetry: true,
        diagnostic,
      };
    case 'rate_limited':
      return {
        code: failure.code,
        title: 'Gửi quá nhanh',
        body: 'Gemini giới hạn số lần gọi trong một khoảng thời gian ngắn.',
        hint: 'Chờ vài giây rồi bấm "Thử lại". Lần tạo vừa rồi không lưu từ nào.',
        canRetry: true,
        diagnostic,
      };
    case 'network':
      return {
        code: failure.code,
        title: 'Không kết nối được tới Gemini',
        body: 'Máy không tới được máy chủ Google. Wi-Fi yếu hoặc mất mạng giữa lúc tạo từ thường gây lỗi này.',
        hint: 'Kiểm tra mạng (thử 4G) rồi bấm "Thử lại". Học và ôn offline vẫn dùng bình thường.',
        canRetry: true,
        diagnostic,
      };
    case 'timeout':
      return {
        code: failure.code,
        title: 'Gemini phản hồi quá lâu',
        body:
          google || 'Yêu cầu vượt quá thời gian chờ nên đã được huỷ, không có từ nào được lưu.',
        hint: 'Giảm số từ cần tạo (5–8 từ) rồi bấm "Thử lại". Lần chờ này không được tự lặp lại.',
        canRetry: true,
        diagnostic,
      };
    case 'server':
      return {
        code: failure.code,
        title: 'Gemini đang bận',
        body: `Máy chủ Gemini trả về lỗi tạm thời.${google ? ` Google trả lời: ${google}` : ''}`,
        hint: 'App đã thử model khác và thử lại vài lần. Chờ khoảng một phút rồi bấm "Thử lại", hoặc chọn model khác trong Cài đặt → Gemini AI.',
        canRetry: true,
        diagnostic,
      };
    case 'model_unavailable':
      return {
        code: failure.code,
        title: 'Model Gemini không dùng được',
        body: google || 'Google đã ngừng cấp model đang cấu hình cho key này.',
        hint: 'Vào Cài đặt → Gemini AI, bấm "Kiểm tra key + model" rồi chọn model Google còn phục vụ.',
        canRetry: false,
        diagnostic,
      };
    case 'invalid_response':
      return {
        code: failure.code,
        title: 'AI trả về dữ liệu không dùng được',
        body: `Gemini trả về nội dung thiếu hoặc bị chặn.${google ? ` Chi tiết: ${google}` : ''}`,
        hint: 'Bấm "Thử lại" để tạo lại. Nếu lặp lại, đổi chủ đề hoặc bớt từ hơn.',
        canRetry: true,
        diagnostic,
      };
    case 'json_parse':
      return {
        code: failure.code,
        title: 'Không đọc được JSON từ Gemini',
        body: google || 'Phản hồi không phải JSON hợp lệ nên không thể kiểm tra từ vựng.',
        hint: 'Bấm "Thử lại" với ít từ hơn để câu trả lời không bị cắt.',
        canRetry: true,
        diagnostic,
      };
    case 'validation':
      return {
        code: failure.code,
        title: 'Yêu cầu chưa hợp lệ',
        body: google || 'Gemini từ chối yêu cầu này.',
        hint: 'Kiểm tra lại cấp độ, chủ đề và số từ rồi thử lại.',
        canRetry: true,
        diagnostic,
      };
    case 'database':
      return {
        code: failure.code,
        title: 'Không lưu được vào máy',
        body: google || 'Cơ sở dữ liệu trên máy từ chối ghi dữ liệu.',
        hint: 'Khởi động lại app rồi thêm lại. Dữ liệu cũ không bị ảnh hưởng.',
        canRetry: true,
        diagnostic,
      };
    case 'busy':
      return {
        code: failure.code,
        title: 'Đang tạo bộ từ khác',
        body: 'Một lần tạo bộ từ đang chạy nên yêu cầu thứ hai bị bỏ qua để tránh trùng dữ liệu.',
        hint: 'Chờ lần đang chạy xong.',
        canRetry: false,
        diagnostic,
      };
    case 'cancelled':
      return {
        code: failure.code,
        title: 'Đã huỷ',
        body: 'Yêu cầu đã dừng trước khi Gemini trả lời.',
        canRetry: false,
        diagnostic,
      };
    case 'unknown':
    default:
      return {
        code: failure.code,
        title: 'Không tạo được bộ từ lúc này',
        body: google
          ? `Không xác định được nguyên nhân. Gemini trả lời: ${google}`
          : 'Không xác định được nguyên nhân.',
        hint: `Mã lỗi: ${failure.code}. Xem Cài đặt → Gemini AI → "Lần gọi gần đây" để biết chi tiết.`,
        canRetry: true,
        diagnostic,
      };
  }
}

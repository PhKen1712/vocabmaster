import { AiError } from './types';

/**
 * Retry engine for calls to Gemini.
 *
 * Only errors that can plausibly succeed on a second attempt are retried
 * (network, timeout, 5xx, per-minute rate limit, plus one single retry for
 * unusable model output). A wrong key and a spent daily quota are never
 * retried: repeating them only burns attempts and confuses the learner.
 */

export const DEFAULT_ATTEMPTS = 3;
export const DEFAULT_BASE_DELAY_MS = 900;
export const DEFAULT_MAX_DELAY_MS = 8_000;
export const DEFAULT_MAX_RETRY_AFTER_MS = 20_000;

export interface RetryInfo {
  /** Attempt that just failed (1-based). */
  attempt: number;
  nextAttempt: number;
  attempts: number;
  delayMs: number;
  error: unknown;
}

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Cap for a server-supplied Retry-After, so we never wait minutes silently. */
  maxRetryAfterMs?: number;
  signal?: AbortSignal;
  /** Injectable for tests. */
  random?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  shouldRetry?: (error: unknown, attempt: number, attempts: number) => boolean;
  retryAfterMs?: (error: unknown) => number | null;
  onRetry?: (info: RetryInfo) => void;
}

/**
 * Exponential backoff with jitter: base * 2^(attempt-1), scaled by 50–100 %.
 * The jitter avoids a burst of identical retries when several requests fail
 * at the same moment, and keeps the first retry from being instant.
 */
export function jitteredDelay(
  attempt: number,
  options: { baseDelayMs?: number; maxDelayMs?: number; random?: () => number } = {},
): number {
  const base = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const max = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const random = options.random ?? Math.random;
  const exponential = Math.min(max, base * 2 ** Math.max(0, attempt - 1));
  const factor = 0.5 + random() * 0.5;
  return Math.round(exponential * factor);
}

/** Sleep that wakes up (and throws) as soon as the caller aborts. */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new AiError('cancelled', 'Đã huỷ yêu cầu.'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    function onAbort() {
      clearTimeout(timer);
      reject(new AiError('cancelled', 'Đã huỷ yêu cầu.'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function defaultRetryAfter(error: unknown): number | null {
  if (error instanceof AiError && typeof error.retryAfterMs === 'number') {
    return error.retryAfterMs;
  }
  return null;
}

export async function retryAsync<T>(
  task: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, Math.floor(options.attempts ?? DEFAULT_ATTEMPTS));
  const shouldRetry = options.shouldRetry ?? (() => true);
  const retryAfterMs = options.retryAfterMs ?? defaultRetryAfter;
  const sleep = options.sleep ?? abortableSleep;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (options.signal?.aborted) throw new AiError('cancelled', 'Đã huỷ yêu cầu.');
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) throw error;
      if (!shouldRetry(error, attempt, attempts)) throw error;

      const requested = retryAfterMs(error);
      const delayMs =
        requested !== null && Number.isFinite(requested)
          ? Math.max(0, Math.min(requested, options.maxRetryAfterMs ?? DEFAULT_MAX_RETRY_AFTER_MS))
          : jitteredDelay(attempt, options);

      options.onRetry?.({ attempt, nextAttempt: attempt + 1, attempts, delayMs, error });
      await sleep(delayMs, options.signal);
    }
  }
  throw lastError;
}

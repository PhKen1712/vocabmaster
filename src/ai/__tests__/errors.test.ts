import { describeAiError, errorFromHttp, parseRetryAfter, redactSecrets } from '../errors';
import { AiError } from '../types';

describe('parseRetryAfter', () => {
  it('reads seconds', () => {
    expect(parseRetryAfter('3')).toBe(3000);
    expect(parseRetryAfter('0')).toBe(0);
  });

  it('reads an HTTP date and clamps past dates to zero', () => {
    const future = new Date(Date.now() + 5000).toUTCString();
    const value = parseRetryAfter(future);
    expect(value).not.toBeNull();
    expect(value).toBeGreaterThan(2000);

    const past = new Date(Date.now() - 60_000).toUTCString();
    expect(parseRetryAfter(past)).toBe(0);
  });

  it('ignores junk', () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('')).toBeNull();
    expect(parseRetryAfter('soon')).toBeNull();
  });
});

describe('redactSecrets', () => {
  it('removes API keys, key headers and query parameters', () => {
    const text = redactSecrets(
      'key AIzaSyD-1234567890abcdefXYZ failed; x-goog-api-key: "AIzaSyD-abcdefghij123456"; url ?key=topsecret&x=1',
    );
    expect(text).not.toContain('AIzaSyD');
    expect(text).not.toContain('topsecret');
    expect(text).toContain('AIza…');
    expect(text).toContain('key=***');
  });

  it('removes a Groq key and a Bearer header', () => {
    const text = redactSecrets(
      'Authorization: Bearer gsk_live_1234567890abcdef failed for gsk_live_1234567890abcdef',
    );
    expect(text).not.toContain('gsk_live_1234567890abcdef');
    expect(text).toContain('gsk_…');
  });
});

describe('errorFromHttp', () => {
  it('maps a rejected key', () => {
    const error = errorFromHttp({
      status: 403,
      message: 'API key not valid. Please pass a valid API key.',
    });
    expect(error.code).toBe('invalid_key');
    expect(error.retryable).toBe(false);
    expect(error.httpStatus).toBe(403);
  });

  it('maps 401 without a message to an invalid key', () => {
    expect(errorFromHttp({ status: 401 }).code).toBe('invalid_key');
  });

  it('maps a retired model to model_unavailable', () => {
    const error = errorFromHttp({
      status: 404,
      message: 'This model models/gemini-2.5-flash is no longer available to new users.',
      statusLabel: 'NOT_FOUND',
    });
    expect(error.code).toBe('model_unavailable');
  });

  it('treats a 429 with Retry-After as a retryable rate limit', () => {
    const error = errorFromHttp({
      status: 429,
      message: 'Resource has been exhausted (e.g. check quota).',
      retryAfterMs: 1500,
    });
    expect(error.code).toBe('rate_limited');
    expect(error.retryable).toBe(true);
    expect(error.retryAfterMs).toBe(1500);
  });

  it('treats a daily quota 429 as a non-retryable quota stop', () => {
    const error = errorFromHttp({
      status: 429,
      message: 'You exceeded your current quota.',
      quotaHint: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
    });
    expect(error.code).toBe('quota_exceeded');
    expect(error.retryable).toBe(false);
  });

  it('classifies 5xx as a retryable server error', () => {
    const error = errorFromHttp({ status: 503, message: 'The model is overloaded.' });
    expect(error.code).toBe('server');
    expect(error.retryable).toBe(true);
  });

  it('classifies other 4xx as validation, not as a transient failure', () => {
    const error = errorFromHttp({ status: 400, message: 'Invalid JSON payload received.' });
    expect(error.code).toBe('validation');
    expect(error.retryable).toBe(false);
  });

  it('keeps an unknown status visible with its HTTP code', () => {
    const error = errorFromHttp({ status: 418, message: 'teapot' });
    expect(error.code).toBe('unknown');
    expect(error.message).toContain('418');
  });
});

describe('describeAiError', () => {
  it('explains a spent quota without pretending it is a bug', () => {
    const view = describeAiError(
      new AiError('quota_exceeded', 'You exceeded your current quota.', { httpStatus: 429 }),
    );
    expect(view.title).toContain('hạn mức');
    expect(view.hint).toContain('Chờ');
    expect(view.canRetry).toBe(true);
    expect(view.diagnostic).toContain('HTTP 429');
  });

  it('tells the learner to check the network on a connection failure', () => {
    const view = describeAiError(new AiError('network', 'Network request failed'));
    expect(view.title).toContain('Không kết nối');
    expect(view.hint).toContain('mạng');
  });

  it('shows an internal code for otherwise unexplained failures', () => {
    const view = describeAiError(new Error('boom'));
    expect(view.code).toBe('unknown');
    expect(view.body).toContain('boom');
    expect(view.hint).toContain('unknown');
  });

  it('takes the provider label for a non-Gemini provider', () => {
    const view = describeAiError(new AiError('invalid_key', 'bad key'), 'Groq');
    expect(view.title).toContain('Groq');
    expect(view.hint).toContain('Groq');
  });

  it('never echoes an API key into the UI', () => {
    const view = describeAiError(
      errorFromHttp({ status: 400, message: 'bad request for AIzaSyD-1234567890abcdef' }),
    );
    const rendered = `${view.title} ${view.body} ${view.hint ?? ''} ${view.diagnostic}`;
    expect(rendered).not.toContain('AIzaSyD');
  });
});

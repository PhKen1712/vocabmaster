const mockGetItem = jest.fn();

jest.mock('expo-secure-store', () => ({
  getItemAsync: (...args: unknown[]) => mockGetItem(...args),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlockedThisDeviceOnly',
}));

import {
  REQUEST_TIMEOUT_MS,
  checkApiKey,
  generateVocabulary,
  rankModels,
  resetGenerationState,
  tokenBudget,
} from '../gemini';
import { clearDiagnostics, getDiagnostics } from '../diagnostics';
import { AiError, type AiRequest } from '../types';

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

const successBody = {
  candidates: [
    {
      finishReason: 'STOP',
      content: {
        parts: [
          {
            text: JSON.stringify({
              words: [
                {
                  term: 'borrow',
                  meaningVi: 'mượn',
                  partOfSpeech: 'verb',
                  level: 2,
                  exampleEn: 'Can I borrow your pen?',
                },
              ],
            }),
          },
        ],
      },
    },
  ],
};

const request: AiRequest = {
  track: 'general',
  level: 2,
  count: 1,
  avoidTerms: [],
  weakTerms: [],
};

const noSleep = jest.fn(async () => undefined);

describe('checkApiKey', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockGetItem.mockReset();
    mockGetItem.mockResolvedValue('AIza-test-key-1234567890');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('reports a missing key without calling the network', async () => {
    mockGetItem.mockResolvedValue(null);
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await checkApiKey('gemini-2.5-flash');

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('Chưa có API key');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts a key whose model is listed by Google', async () => {
    globalThis.fetch = jest.fn(async () =>
      jsonResponse(200, { models: [{ name: 'models/gemini-2.5-flash' }] }),
    ) as unknown as typeof fetch;

    const result = await checkApiKey('gemini-2.5-flash');

    expect(result.ok).toBe(true);
    expect(result.detail).toContain('gemini-2.5-flash');
  });

  it('flags a valid key pointing at a model that does not exist', async () => {
    globalThis.fetch = jest.fn(async () =>
      jsonResponse(200, {
        models: [{ name: 'models/gemini-2.5-pro' }, { name: 'models/gemini-2.5-flash' }],
      }),
    ) as unknown as typeof fetch;

    const result = await checkApiKey('gemini-9-flash');

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('không tồn tại');
    expect(result.detail).toContain('gemini-2.5-flash');
  });

  it('keeps Google status and message when the key is rejected', async () => {
    globalThis.fetch = jest.fn(async () =>
      jsonResponse(403, { error: { message: 'API key not valid. Please pass a valid API key.' } }),
    ) as unknown as typeof fetch;

    const result = await checkApiKey('gemini-2.5-flash');

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('403');
    expect(result.detail).toContain('API key not valid');
  });

  it('distinguishes a network failure from a rejected key', async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;

    const result = await checkApiKey('gemini-2.5-flash');

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('Không kết nối được');
  });

  it('suggests a model that still exists when the configured one was retired', async () => {
    globalThis.fetch = jest.fn(async () =>
      jsonResponse(200, {
        models: [
          { name: 'models/embedding-001' },
          { name: 'models/gemini-2.5-lite' },
          { name: 'models/gemini-3.8-flash' },
        ],
      }),
    ) as unknown as typeof fetch;

    const result = await checkApiKey('gemini-2.5-flash');

    expect(result.ok).toBe(false);
    expect(result.suggestedModel).toBe('gemini-3.8-flash');
    expect(result.detail).toContain('không tồn tại');
  });
});

describe('rankModels', () => {
  it('prefers the newest flash model and skips embeddings and lite variants', () => {
    expect(
      rankModels([
        'models/embedding-001',
        'models/gemini-2.5-lite',
        'models/gemini-2.5-pro',
        'models/gemini-3.8-flash',
        'models/gemini-3.5-flash',
      ]),
    ).toEqual(['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-2.5-pro']);
  });

  it('drops the model that is already failing', () => {
    expect(rankModels(['gemini-3.8-flash', 'gemini-3.5-flash'], 'gemini-3.8-flash')).toEqual([
      'gemini-3.5-flash',
    ]);
  });
});

describe('tokenBudget', () => {
  it('gives a short list headroom and grows with the request', () => {
    expect(tokenBudget(1)).toBe(2048);
    expect(tokenBudget(8)).toBe(4800);
    expect(tokenBudget(20)).toBe(8192);
  });

  it('never exceeds the model output cap', () => {
    expect(tokenBudget(200)).toBe(8192);
  });
});

describe('generateVocabulary when the model was retired', () => {
  const originalFetch = globalThis.fetch;

  const retiredBody = {
    error: {
      code: 404,
      status: 'NOT_FOUND',
      message:
        'This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.8-flash for the latest features.',
    },
  };

  beforeEach(() => {
    mockGetItem.mockReset();
    mockGetItem.mockResolvedValue('AIza-test-key-1234567890');
    resetGenerationState();
    clearDiagnostics();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('retries once with a model Google still serves and reports the switch', async () => {
    const fetchMock = jest.fn(async (url: string) => {
      if (url.includes('/models?') || url.endsWith('/v1beta/models')) {
        return jsonResponse(200, {
          models: [
            { name: 'models/gemini-2.5-pro' },
            { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
          ],
        });
      }
      if (url.includes('gemini-3.8-flash')) return jsonResponse(200, successBody);
      return jsonResponse(404, retiredBody);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await generateVocabulary(request, 'gemini-2.5-flash');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.model).toBe('gemini-3.8-flash');
    expect(result.fallbackFrom).toBe('gemini-2.5-flash');
    expect(result.suggestions[0]?.term).toBe('borrow');
  });

  it('fails with an actionable error when no replacement model exists', async () => {
    const fetchMock = jest.fn(async (url: string) => {
      if (url.endsWith('/v1beta/models')) {
        return jsonResponse(200, { models: [{ name: 'models/gemini-2.5-flash' }] });
      }
      return jsonResponse(404, retiredBody);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(generateVocabulary(request, 'gemini-2.5-flash')).rejects.toMatchObject({
      name: 'AiError',
      code: 'model_unavailable',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    try {
      await generateVocabulary(request, 'gemini-2.5-flash');
    } catch (error) {
      expect(error).toBeInstanceOf(AiError);
      expect((error as AiError).message).toContain('Cài đặt');
    }
  });
});

describe('generateVocabulary retry and failure handling', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockGetItem.mockReset();
    mockGetItem.mockResolvedValue('AIza-test-key-1234567890');
    resetGenerationState();
    clearDiagnostics();
    noSleep.mockClear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('retries a 503 and succeeds on the second attempt', async () => {
    let calls = 0;
    const fetchMock = jest.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse(503, {
          error: { code: 503, status: 'UNAVAILABLE', message: 'The model is overloaded.' },
        });
      }
      return jsonResponse(200, successBody);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await generateVocabulary(request, {
      model: 'gemini-3.8-flash',
      sleep: noSleep,
    });

    // The failed attempt now also asks Google which other models exist; that
    // mock answers 503 too, so no replacement is found and the retry happens on
    // the same model.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.attempts).toBe(2);
    expect(result.suggestions).toHaveLength(1);
    expect(result.fallbackFrom ?? null).toBeNull();
    // The learner can see that a retry happened, without any secret.
    const diagnostics = getDiagnostics();
    expect(diagnostics.some((entry) => entry.outcome === 'retry')).toBe(true);
    expect(JSON.stringify(diagnostics)).not.toContain('AIza');
  });

  it('switches to another model when the chosen one is overloaded', async () => {
    const overload = {
      error: {
        code: 503,
        status: 'UNAVAILABLE',
        message: 'This model is currently experiencing high demand. Please try again later.',
      },
    };
    const fetchMock = jest.fn(async (url: string) => {
      if (url.endsWith('/v1beta/models')) {
        return jsonResponse(200, {
          models: [
            { name: 'models/gemini-3.8-flash' },
            { name: 'models/gemini-3.5-flash' },
            { name: 'models/gemini-2.5-pro' },
          ],
        });
      }
      if (url.includes('gemini-3.8-flash')) return jsonResponse(503, overload);
      return jsonResponse(200, successBody);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await generateVocabulary(request, {
      model: 'gemini-3.8-flash',
      sleep: noSleep,
    });

    expect(result.model).toBe('gemini-3.5-flash');
    expect(result.fallbackFrom).toBe('gemini-3.8-flash');
    expect(result.fallbackReason).toBe('overloaded');
    // No backoff wait was needed: the busy model was replaced immediately.
    expect(result.attempts).toBe(1);
    expect(noSleep).not.toHaveBeenCalled();
    expect(
      getDiagnostics().some(
        (entry) => entry.phase === 'config' && (entry.detail ?? '').includes('quá tải'),
      ),
    ).toBe(true);
  });

  it('stops after the replacement model is overloaded as well', async () => {
    const overload = {
      error: { code: 503, status: 'UNAVAILABLE', message: 'The model is overloaded.' },
    };
    const fetchMock = jest.fn(async (url: string) => {
      if (url.endsWith('/v1beta/models')) {
        return jsonResponse(200, {
          models: [{ name: 'models/gemini-3.8-flash' }, { name: 'models/gemini-3.5-flash' }],
        });
      }
      return jsonResponse(503, overload);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      generateVocabulary(request, { model: 'gemini-3.8-flash', sleep: noSleep }),
    ).rejects.toMatchObject({ code: 'server' });

    const posts = fetchMock.mock.calls.filter(([url]) => String(url).includes(':generateContent'));
    const listings = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/v1beta/models'));
    // One call to the busy model, one to the replacement, one last retry: the
    // switch must not double the retry budget.
    expect(posts).toHaveLength(3);
    expect(listings).toHaveLength(1);
    expect(noSleep).toHaveBeenCalledTimes(1);
  });

  it('does not retry a rejected key', async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse(401, {
        error: { code: 401, status: 'UNAUTHENTICATED', message: 'Request had invalid authentication credentials.' },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      generateVocabulary(request, { model: 'gemini-3.8-flash', sleep: noSleep }),
    ).rejects.toMatchObject({ code: 'invalid_key' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry a spent daily quota', async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse(429, {
        error: {
          code: 429,
          status: 'RESOURCE_EXHAUSTED',
          message: 'You exceeded your current quota.',
          details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }],
        },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      generateVocabulary(request, { model: 'gemini-3.8-flash', sleep: noSleep }),
    ).rejects.toMatchObject({ code: 'quota_exceeded' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('explains a truncated answer instead of failing with a generic error', async () => {
    const cut = '{"words":[{"term":"borrow","meaningVi":"mượn"';
    const fetchMock = jest.fn(async () =>
      jsonResponse(200, {
        candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: cut }] } }],
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      generateVocabulary(request, { model: 'gemini-3.8-flash', sleep: noSleep }),
    ).rejects.toMatchObject({ code: 'json_parse' });
    // One automatic retry for unusable output, then stop.
    expect(fetchMock).toHaveBeenCalledTimes(2);

    try {
      await generateVocabulary(request, { model: 'gemini-3.8-flash', sleep: noSleep });
    } catch (error) {
      expect((error as AiError).message).toContain('cắt');
    }
  });

  it('validates the request before spending an API call', async () => {
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      generateVocabulary({ ...request, count: 25 }, { model: 'gemini-3.8-flash' }),
    ).rejects.toMatchObject({ code: 'validation' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shares one call when the same request is fired twice', async () => {
    const fetchMock = jest.fn(async () => jsonResponse(200, successBody));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const [first, second] = await Promise.all([
      generateVocabulary(request, { model: 'gemini-3.8-flash', sleep: noSleep }),
      generateVocabulary(request, { model: 'gemini-3.8-flash', sleep: noSleep }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.suggestions[0]?.term).toBe(second.suggestions[0]?.term);
  });

  it('stops waiting as soon as the learner cancels, even if fetch never answers', async () => {
    // A fetch that ignores its abort signal is the worst case: the old screen
    // stayed on "Gemini đang tạo…" forever.
    globalThis.fetch = jest.fn(() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    const controller = new AbortController();

    const pending = generateVocabulary(request, {
      model: 'gemini-3.8-flash',
      signal: controller.signal,
      sleep: noSleep,
    });
    await Promise.resolve();
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('reports a timeout instead of hanging when the request never answers', async () => {
    globalThis.fetch = jest.fn(() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;

    await expect(
      generateVocabulary(request, {
        model: 'gemini-3.8-flash',
        attempts: 1,
        timeoutMs: 20,
        sleep: noSleep,
      }),
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  it('uses a 20 second deadline by default', () => {
    expect(REQUEST_TIMEOUT_MS).toBe(20_000);
  });

  it('does not retry a timeout: the learner already waited the deadline', async () => {
    const fetchMock = jest.fn(() => new Promise<Response>(() => undefined));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      generateVocabulary(request, {
        model: 'gemini-3.8-flash',
        timeoutMs: 20,
        sleep: noSleep,
      }),
    ).rejects.toMatchObject({ code: 'timeout' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses a different request while one is already running', async () => {
    let release!: (value: unknown) => void;
    const gate = new Promise<unknown>((resolve) => {
      release = resolve;
    });
    globalThis.fetch = jest.fn(async () => {
      await gate;
      return jsonResponse(200, successBody);
    }) as unknown as typeof fetch;

    const running = generateVocabulary(request, { model: 'gemini-3.8-flash', sleep: noSleep });
    await expect(
      generateVocabulary({ ...request, count: 5 }, { model: 'gemini-3.8-flash', sleep: noSleep }),
    ).rejects.toMatchObject({ code: 'busy' });

    release(null);
    await expect(running).resolves.toBeDefined();
  });
});

describe('generateVocabulary for a pasted list', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockGetItem.mockReset();
    mockGetItem.mockResolvedValue('AIza-test-key-1234567890');
    resetGenerationState();
    clearDiagnostics();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('asks for everyday meanings for the exact pasted terms', async () => {
    const answer = {
      candidates: [
        {
          finishReason: 'STOP',
          content: {
            parts: [
              {
                text: JSON.stringify({
                  words: [
                    {
                      term: 'make a decision',
                      meaningVi: 'đưa ra quyết định',
                      definitionEn: 'to choose after thinking about it',
                      partOfSpeech: 'phrase',
                      exampleEn: 'We need to make a decision today.',
                    },
                    {
                      term: 'run out of',
                      meaningVi: 'hết, không còn nữa',
                      partOfSpeech: 'phrasal verb',
                    },
                  ],
                }),
              },
            ],
          },
        },
      ],
    };
    let sent = '';
    globalThis.fetch = jest.fn(async (_url: string, init?: { body?: string }) => {
      sent = init?.body ?? '';
      return jsonResponse(200, answer);
    }) as unknown as typeof fetch;

    const result = await generateVocabulary({
      ...request,
      count: 2,
      explainTerms: ['make a decision', 'run out of'],
    });

    expect(sent).toContain('Explain exactly 2 English item(s)');
    expect(sent).toContain('1. make a decision');
    expect(sent).toContain('2. run out of');
    expect(sent).toContain('most common, everyday Vietnamese meaning');
    expect(result.suggestions.map((item) => item.meaningVi)).toEqual([
      'đưa ra quyết định',
      'hết, không còn nữa',
    ]);
  });
});

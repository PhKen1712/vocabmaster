const mockGetItem = jest.fn();

jest.mock('expo-secure-store', () => ({
  // Lớp lưu trữ chung ghi/đọc một khoá thử trước khi tin Keychain. Mock phải trả
  // đúng như Keychain thật, nếu không lớp đó sẽ chuyển sang kho dự phòng.
  isAvailableAsync: async () => true,
  getItemAsync: (key: string) =>
    key === '__vm_storage_probe__' ? Promise.resolve('ok') : mockGetItem(key),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlockedThisDeviceOnly',
}));

import { clearDiagnostics, getDiagnostics } from '../diagnostics';
import {
  checkGroqKey,
  generateVocabularyGroq,
  rankGroqModels,
  resetGroqGenerationState,
  tokenBudgetGroq,
} from '../groq';
import type { AiRequest } from '../types';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  } as unknown as Response;
}

const successBody = {
  choices: [
    {
      finish_reason: 'stop',
      message: {
        content: JSON.stringify({
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

describe('generateVocabularyGroq', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockGetItem.mockReset();
    mockGetItem.mockResolvedValue('gsk_test_key_1234567890');
    resetGroqGenerationState();
    clearDiagnostics();
    noSleep.mockClear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends one OpenAI-compatible JSON request with the key in a Bearer header', async () => {
    const fetchMock = jest.fn(async () => jsonResponse(200, successBody));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await generateVocabularyGroq(request, {
      model: 'openai/gpt-oss-120b',
      sleep: noSleep,
    });

    expect(result.suggestions[0]?.term).toBe('borrow');
    expect(result.model).toBe('openai/gpt-oss-120b');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer gsk_test_key_1234567890');

    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.model).toBe('openai/gpt-oss-120b');
    expect(body.response_format).toEqual({ type: 'json_object' });
    // gpt-oss is a reasoning model; hidden reasoning keeps the JSON clean.
    expect(body.reasoning_format).toBe('hidden');
    expect(body.reasoning_effort).toBe('low');
    expect(body.max_completion_tokens).toBe(tokenBudgetGroq(1));
    const messages = body.messages as { role: string; content: string }[];
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe('user');
  });

  it('omits reasoning fields for a non-reasoning model', async () => {
    const fetchMock = jest.fn(async () => jsonResponse(200, successBody));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await generateVocabularyGroq(request, { model: 'llama-guard-4-12b', sleep: noSleep });

    const init = (fetchMock.mock.calls[0] as unknown as unknown[])[1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.reasoning_format).toBeUndefined();
    expect(body.reasoning_effort).toBeUndefined();
  });

  it('honours retry-after on a per-minute 429 and then succeeds', async () => {
    let calls = 0;
    const fetchMock = jest.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse(
          429,
          {
            error: {
              message: 'Rate limit reached for model on requests per minute (RPM).',
              type: 'tokens',
            },
          },
          { 'retry-after': '2' },
        );
      }
      return jsonResponse(200, successBody);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await generateVocabularyGroq(request, {
      model: 'openai/gpt-oss-120b',
      sleep: noSleep,
    });

    expect(result.attempts).toBe(2);
    expect(noSleep).toHaveBeenCalledWith(2000, undefined);
    expect(getDiagnostics().some((entry) => entry.outcome === 'retry')).toBe(true);
  });

  it('does not retry the daily token cap', async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse(429, {
        error: {
          message: 'Rate limit reached for model on tokens per day (TPD): Limit 200000.',
          type: 'tokens',
        },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      generateVocabularyGroq(request, { model: 'openai/gpt-oss-120b', sleep: noSleep }),
    ).rejects.toMatchObject({ code: 'quota_exceeded' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('replaces a retired model with an active preferred one', async () => {
    const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/models')) {
        return jsonResponse(200, {
          data: [
            { id: 'whisper-large-v3', active: true },
            { id: 'openai/gpt-oss-120b', active: false },
            { id: 'openai/gpt-oss-20b', active: true },
            { id: 'qwen/qwen3.8-27b', active: true },
          ],
        });
      }
      const body = JSON.parse(String(init?.body));
      if (body.model === 'openai/gpt-oss-120b') {
        return jsonResponse(404, {
          error: { message: 'The model `openai/gpt-oss-120b` has been decommissioned.', type: 'invalid_request_error' },
        });
      }
      return jsonResponse(200, successBody);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await generateVocabularyGroq(request, {
      model: 'openai/gpt-oss-120b',
      sleep: noSleep,
    });

    expect(result.model).toBe('openai/gpt-oss-20b');
    expect(result.fallbackFrom).toBe('openai/gpt-oss-120b');
    expect(result.fallbackReason).toBe('retired');
  });

  it('refuses a second, different request while one is running', async () => {
    let release!: (value: unknown) => void;
    const gate = new Promise<unknown>((resolve) => {
      release = resolve;
    });
    globalThis.fetch = jest.fn(async () => {
      await gate;
      return jsonResponse(200, successBody);
    }) as unknown as typeof fetch;

    const running = generateVocabularyGroq(request, {
      model: 'openai/gpt-oss-120b',
      sleep: noSleep,
    });
    await expect(
      generateVocabularyGroq({ ...request, count: 4 }, {
        model: 'openai/gpt-oss-120b',
        sleep: noSleep,
      }),
    ).rejects.toMatchObject({ code: 'busy' });

    release(null);
    await expect(running).resolves.toBeDefined();
  });

  it('reports a missing key before calling the network', async () => {
    mockGetItem.mockResolvedValue(null);
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      generateVocabularyGroq(request, { model: 'openai/gpt-oss-120b' }),
    ).rejects.toMatchObject({ code: 'missing_key' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('rankGroqModels', () => {
  it('prefers known text models and skips speech and guard models', () => {
    expect(
      rankGroqModels([
        'whisper-large-v3',
        'meta-llama/llama-prompt-guard-2-22m',
        'qwen/qwen3.8-27b',
        'openai/gpt-oss-20b',
        'openai/gpt-oss-120b',
      ]),
    ).toEqual(['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b']);
  });

  it('never suggests the model that just failed', () => {
    expect(
      rankGroqModels(['openai/gpt-oss-120b', 'openai/gpt-oss-20b'], 'openai/gpt-oss-120b'),
    ).toEqual(['openai/gpt-oss-20b']);
  });
});

describe('tokenBudgetGroq', () => {
  it('leaves room for the prompt under the free tier token cap', () => {
    expect(tokenBudgetGroq(1)).toBe(1600);
    expect(tokenBudgetGroq(8)).toBe(4400);
    expect(tokenBudgetGroq(20)).toBe(6144);
  });
});

describe('checkGroqKey', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockGetItem.mockReset();
    mockGetItem.mockResolvedValue('gsk_test_key_1234567890');
    clearDiagnostics();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('reports a missing key without calling the network', async () => {
    mockGetItem.mockResolvedValue(null);
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await checkGroqKey('openai/gpt-oss-120b');
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('Chưa có API key Groq');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts a key whose model is listed', async () => {
    globalThis.fetch = jest.fn(async () =>
      jsonResponse(200, { data: [{ id: 'openai/gpt-oss-120b', active: true }] }),
    ) as unknown as typeof fetch;

    const result = await checkGroqKey('openai/gpt-oss-120b');
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('openai/gpt-oss-120b');
  });

  it('suggests an active model when the configured one is gone', async () => {
    globalThis.fetch = jest.fn(async () =>
      jsonResponse(200, {
        data: [
          { id: 'whisper-large-v3' },
          { id: 'openai/gpt-oss-20b', active: true },
          { id: 'openai/gpt-oss-120b', active: false },
        ],
      }),
    ) as unknown as typeof fetch;

    const result = await checkGroqKey('openai/gpt-oss-120b');
    expect(result.ok).toBe(false);
    expect(result.suggestedModel).toBe('openai/gpt-oss-20b');
    expect(result.detail).toContain('không có trong tài khoản Groq');
  });

  it('keeps the Groq message when the key is rejected', async () => {
    globalThis.fetch = jest.fn(async () =>
      jsonResponse(401, { error: { message: 'Invalid API Key', type: 'invalid_request_error' } }),
    ) as unknown as typeof fetch;

    const result = await checkGroqKey('openai/gpt-oss-120b');
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('Key bị Groq từ chối');
    expect(result.detail).toContain('Invalid API Key');
  });
});

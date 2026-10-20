const mockGetItem = jest.fn();

jest.mock('expo-secure-store', () => ({
  getItemAsync: (...args: unknown[]) => mockGetItem(...args),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlockedThisDeviceOnly',
}));

import { checkApiKey, generateVocabulary, rankModels } from '../gemini';
import { AiError, type AiRequest } from '../types';

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

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

describe('generateVocabulary when the model was retired', () => {
  const originalFetch = globalThis.fetch;
  const request: AiRequest = {
    track: 'general',
    level: 2,
    count: 1,
    avoidTerms: [],
    weakTerms: [],
  };

  const successBody = {
    candidates: [
      {
        content: {
          parts: [
            {
              text: JSON.stringify({
                words: [{ term: 'borrow', meaningVi: 'mượn', partOfSpeech: 'verb', level: 2 }],
              }),
            },
          ],
        },
      },
    ],
  };

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

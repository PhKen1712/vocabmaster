const mockGetItem = jest.fn();

jest.mock('expo-secure-store', () => ({
  getItemAsync: (...args: unknown[]) => mockGetItem(...args),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlockedThisDeviceOnly',
}));

import { estimateLevels, parseLevels } from '../levels';

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

describe('parseLevels', () => {
  it('keeps only the items it asked about, with a level in range', () => {
    const levels = parseLevels(
      {
        levels: [
          { term: 'water', level: 0 },
          { term: '  Borrow ', level: 1 },
          { term: 'unprecedented', level: 5.4 },
          { term: 'unknown-word', level: 3 },
          { term: 'water', level: 9 },
          { term: 'borrow', level: 'x' },
        ],
      },
      ['water', 'borrow', 'unprecedented'],
    );

    expect(levels.get('water')).toBe(0);
    expect(levels.get('borrow')).toBe(1);
    expect(levels.get('unprecedented')).toBe(5);
    expect(levels.has('unknown-word')).toBe(false);
    expect(levels.size).toBe(3);
  });

  it('returns an empty map for a malformed answer', () => {
    expect(parseLevels(null, ['water']).size).toBe(0);
    expect(parseLevels({ words: [] }, ['water']).size).toBe(0);
  });
});

describe('estimateLevels', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockGetItem.mockReset();
    mockGetItem.mockResolvedValue('gsk_test_key_1234567890');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('asks Groq once for the whole list', async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse(200, {
        choices: [
          {
            message: {
              content: JSON.stringify({
                levels: [
                  { term: 'water', level: 0 },
                  { term: 'unprecedented', level: 6 },
                ],
              }),
            },
          },
        ],
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await estimateLevels(['water', 'unprecedented'], {
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.error).toBeNull();
    expect(result.levels.get('water')).toBe(0);
    expect(result.levels.get('unprecedented')).toBe(6);

    const init = (fetchMock.mock.calls[0] as unknown as unknown[])[1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[0].content).toContain('water');
  });

  it('works with Gemini too', async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse(200, {
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify({ levels: [{ term: 'water', level: 0 }] }) }],
            },
          },
        ],
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await estimateLevels(['water'], {
      provider: 'gemini',
      model: 'gemini-3.8-flash',
    });

    expect(result.levels.get('water')).toBe(0);
    expect(String((fetchMock.mock.calls[0] as unknown as unknown[])[0])).toContain(
      ':generateContent',
    );
  });

  it('explains a missing key instead of calling the network', async () => {
    mockGetItem.mockResolvedValue(null);
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await estimateLevels(['water'], {
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
    });

    expect(result.levels.size).toBe(0);
    expect(result.error).toContain('API key');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a message, not a crash, when the request fails', async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;

    const result = await estimateLevels(['water'], {
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
    });

    expect(result.levels.size).toBe(0);
    expect(result.error).toContain('Chưa xác định được cấp độ');
  });
});

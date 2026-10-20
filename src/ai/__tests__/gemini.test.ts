const mockGetItem = jest.fn();

jest.mock('expo-secure-store', () => ({
  getItemAsync: (...args: unknown[]) => mockGetItem(...args),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlockedThisDeviceOnly',
}));

import { checkApiKey } from '../gemini';

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
});

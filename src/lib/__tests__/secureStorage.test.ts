/**
 * Lỗi thật đã gặp: trên web, `expo-secure-store` là object rỗng nên lưu Groq key
 * ném "setValueWithKeyAsync is not a function". Bộ test này khoá lại hành vi
 * đúng — lưu/đọc được trên trình duyệt, và không ném TypeError khó hiểu khi
 * thiết bị không có Keychain.
 */

function installLocalStorage(options: { throwOnAccess?: boolean } = {}) {
  const map = new Map<string, string>();
  const storage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      if (options.throwOnAccess) throw new Error('localStorage bị chặn');
      return storage;
    },
  });
  return map;
}

describe('kho bí mật theo nền tảng', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('lưu và đọc key trên web bằng localStorage, không cần Keychain', async () => {
    const map = installLocalStorage();
    jest.doMock('react-native', () => ({ Platform: { OS: 'web' } }));

    const module = require('../secureStorage') as typeof import('../secureStorage');
    module.resetSecureStorageCache();
    const backend = await module.saveSecret('groq_api_key', 'gsk_test_1234567890abcdef');

    expect(backend).toBe('browser');
    expect(await module.loadSecret('groq_api_key')).toBe('gsk_test_1234567890abcdef');
    expect(map.get('groq_api_key')).toBe('gsk_test_1234567890abcdef');

    await module.removeSecret('groq_api_key');
    expect(await module.loadSecret('groq_api_key')).toBeNull();
  });

  it('cho kết quả null thay vì ném lỗi khi localStorage bị chặn', async () => {
    installLocalStorage({ throwOnAccess: true });
    jest.doMock('react-native', () => ({ Platform: { OS: 'web' } }));

    const module = require('../secureStorage') as typeof import('../secureStorage');
    module.resetSecureStorageCache();

    // Không có chỗ lưu bền vững: phải báo rõ ràng, không được ghi như đã lưu.
    await expect(module.saveSecret('groq_api_key', 'gsk_test_1234567890abcdef')).rejects.toThrow(
      /không có chỗ lưu an toàn/i,
    );
  });

  it('bản IPA cũ thiếu module native không làm ném TypeError', async () => {
    jest.doMock('react-native', () => ({ Platform: { OS: 'ios' } }));
    jest.doMock('expo-secure-store', () => ({
      // Đúng hình dạng lỗi cũ: hàm native không tồn tại.
      isAvailableAsync: async () => true,
      setItemAsync: () => {
        throw new TypeError('setValueWithKeyAsync is not a function');
      },
      getItemAsync: async () => null,
      deleteItemAsync: async () => undefined,
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlockedThisDeviceOnly',
    }));
    jest.doMock('expo-sqlite/kv-store', () => ({
      default: {
        getItem: async () => null,
        setItem: async () => {
          throw new Error('SQLite chưa sẵn sàng');
        },
        removeItem: async () => undefined,
      },
    }));

    const module = require('../secureStorage') as typeof import('../secureStorage');
    module.resetSecureStorageCache();

    await expect(module.saveSecret('groq_api_key', 'gsk_test_1234567890abcdef')).rejects.toThrow(
      /không có chỗ lưu an toàn/i,
    );
  });
});

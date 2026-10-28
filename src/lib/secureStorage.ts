import { Platform } from 'react-native';

/**
 * Kho khoá/bí mật dùng chung cho cả iOS và web.
 *
 * Vì sao cần lớp này thay vì gọi thẳng `expo-secure-store`:
 *
 * - `expo-secure-store` chỉ có bản native. Bản web của nó là một object rỗng,
 *   nên `setItemAsync` gọi `ExpoSecureStore.setValueWithKeyAsync` và ném
 *   "setValueWithKeyAsync is not a function". Đó là lỗi thật đã gặp khi lưu
 *   Groq key trên trình duyệt.
 * - Một bản IPA cũ có thể chưa nhúng module native này. Khi đó Keychain không
 *   tồn tại dù JS có nghĩ là có.
 *
 * Cách xử lý: chỉ dùng Keychain khi nó THỰC SỰ ghi/đọc được (probe thật, không
 * đoán theo tên hàm), còn không thì dùng kho dự phòng đã có sẵn trong mọi bản
 * build (`expo-sqlite/kv-store`, hoặc localStorage trên web). Không có hàm giả:
 * nếu cả hai đều hỏng thì dùng bộ nhớ tạm và báo rõ backend đang dùng.
 */

export type StorageBackend = 'keychain' | 'sqlite' | 'browser' | 'memory';

export interface SecureKeyStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  readonly backend: StorageBackend;
  /** true khi không có chỗ lưu bền vững — dữ liệu mất khi đóng app. */
  readonly temporary: boolean;
}

const PROBE_KEY = '__vm_storage_probe__';
const PROBE_VALUE = 'ok';

function memoryStore(): SecureKeyStore {
  const map = new Map<string, string>();
  return {
    backend: 'memory',
    temporary: true,
    async getItem(key) {
      return map.get(key) ?? null;
    },
    async setItem(key, value) {
      map.set(key, value);
    },
    async removeItem(key) {
      map.delete(key);
    },
  };
}

function browserStore(): SecureKeyStore | null {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return null;
    // Safari ở chế độ riêng tư có thể có localStorage nhưng ném khi ghi.
    storage.setItem(PROBE_KEY, PROBE_VALUE);
    const read = storage.getItem(PROBE_KEY);
    storage.removeItem(PROBE_KEY);
    if (read !== PROBE_VALUE) return null;
    return {
      backend: 'browser',
      temporary: false,
      async getItem(key) {
        try {
          return storage.getItem(key);
        } catch {
          return null;
        }
      },
      async setItem(key, value) {
        storage.setItem(key, value);
      },
      async removeItem(key) {
        storage.removeItem(key);
      },
    };
  } catch {
    return null;
  }
}

type SecureStoreModule = {
  setItemAsync?: (key: string, value: string, options?: Record<string, unknown>) => Promise<void>;
  getItemAsync?: (key: string) => Promise<string | null>;
  deleteItemAsync?: (key: string) => Promise<void>;
  isAvailableAsync?: () => Promise<boolean>;
  WHEN_UNLOCKED_THIS_DEVICE_ONLY?: string;
};

async function secureStore(): Promise<SecureKeyStore | null> {
  try {
    // require động: bản web không kéo module native vào bundle khi không dùng.
    const module = require('expo-secure-store') as SecureStoreModule;
    if (
      typeof module?.setItemAsync !== 'function' ||
      typeof module?.getItemAsync !== 'function' ||
      typeof module?.deleteItemAsync !== 'function'
    ) {
      return null;
    }
    if (typeof module.isAvailableAsync === 'function') {
      const available = await module.isAvailableAsync();
      if (!available) return null;
    }
    // Probe thật: đây là bước bắt được đúng lỗi "hàm native không tồn tại".
    const options =
      module.WHEN_UNLOCKED_THIS_DEVICE_ONLY === undefined
        ? undefined
        : { keychainAccessible: module.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
    await module.setItemAsync(PROBE_KEY, PROBE_VALUE, options);
    const read = await module.getItemAsync(PROBE_KEY);
    await module.deleteItemAsync(PROBE_KEY).catch(() => undefined);
    if (read !== PROBE_VALUE) return null;

    return {
      backend: 'keychain',
      temporary: false,
      getItem: (key) => module.getItemAsync!(key),
      setItem: (key, value) => module.setItemAsync!(key, value, options),
      removeItem: async (key) => {
        await module.deleteItemAsync!(key);
      },
    };
  } catch {
    return null;
  }
}

type KvStore = {
  getItem?: (key: string) => Promise<string | null>;
  setItem?: (key: string, value: string) => Promise<void>;
  removeItem?: (key: string) => Promise<void>;
};

async function sqliteKvStore(): Promise<SecureKeyStore | null> {
  try {
    const module = require('expo-sqlite/kv-store') as KvStore & { default?: KvStore };
    const store = (module.default ?? module) as KvStore;
    if (
      typeof store.getItem !== 'function' ||
      typeof store.setItem !== 'function' ||
      typeof store.removeItem !== 'function'
    ) {
      return null;
    }
    await store.setItem(PROBE_KEY, PROBE_VALUE);
    const read = await store.getItem(PROBE_KEY);
    await store.removeItem(PROBE_KEY);
    if (read !== PROBE_VALUE) return null;

    return {
      backend: 'sqlite',
      temporary: false,
      getItem: (key) => store.getItem!(key),
      setItem: (key, value) => store.setItem!(key, value),
      removeItem: async (key) => {
        await store.removeItem!(key);
      },
    };
  } catch {
    return null;
  }
}

let cached: Promise<SecureKeyStore> | null = null;

/**
 * Chọn kho phù hợp với nền tảng, đã kiểm tra bằng ghi/đọc thật.
 * Kết quả được cache: probe chỉ chạy một lần cho mỗi lần khởi động app.
 */
export function getSecureStorage(): Promise<SecureKeyStore> {
  if (!cached) {
    cached = (async () => {
      if (Platform.OS === 'web') {
        return browserStore() ?? memoryStore();
      }
      return (await secureStore()) ?? (await sqliteKvStore()) ?? memoryStore();
    })();
  }
  return cached;
}

/** Chỉ dùng trong test: xoá cache để mô phỏng lần khởi động mới. */
export function resetSecureStorageCache(): void {
  cached = null;
}

/**
 * Lưu một khoá bí mật. Ném lỗi có thể đọc được nếu không nơi nào ghi được,
 * để màn hình cài đặt báo thật thay vì hiện "đã lưu" giả.
 */
export async function saveSecret(key: string, value: string): Promise<StorageBackend> {
  const store = await getSecureStorage();
  if (store.temporary) {
    // Không có chỗ lưu bền vững: nói thẳng thay vì hiện "đã lưu" rồi mất khi
    // đóng app. Đây là trường hợp gặp thật khi Keychain hỏng trên bản IPA cũ.
    throw new Error(
      'Thiết bị này không có chỗ lưu an toàn (Keychain/ổ đĩa bị chặn). Khoá chỉ dùng được trong phiên hiện tại và sẽ mất khi đóng ứng dụng.',
    );
  }
  try {
    await store.setItem(key, value);
  } catch (error) {
    throw error instanceof Error
      ? error
      : new Error('Không ghi được vào kho bảo mật của thiết bị.');
  }
  return store.backend;
}

export async function loadSecret(key: string): Promise<string | null> {
  const store = await getSecureStorage();
  try {
    return await store.getItem(key);
  } catch {
    return null;
  }
}

export async function removeSecret(key: string): Promise<void> {
  const store = await getSecureStorage();
  try {
    await store.removeItem(key);
  } catch {
    // Không xoá được thì lần đọc sau vẫn trả null nếu key đã mất hiệu lực.
  }
}

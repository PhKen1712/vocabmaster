import { Platform } from 'react-native';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { getSecureStorage } from '../lib/secureStorage';
import { CLOUD_ANON_KEY, CLOUD_URL, cloudConfigured } from './config';

/**
 * Nơi lưu phiên đăng nhập.
 *
 * - iOS/Android: Keychain/Keystore qua expo-secure-store → phiên không nằm trong
 *   file sao lưu dễ đọc.
 * - Web: localStorage. Trình duyệt không có Keychain, nên đây là mức an toàn
 *   thấp hơn — ghi rõ trong README thay vì hứa hẹn sai.
 */
const memoryFallback = new Map<string, string>();

const webStorage = {
  getItem: (key: string) => {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return memoryFallback.get(key) ?? null;
    }
  },
  setItem: (key: string, value: string) => {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      memoryFallback.set(key, value);
    }
  },
  removeItem: (key: string) => {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      memoryFallback.delete(key);
    }
  },
};

function createSecureStoreAdapter() {
  // Dùng lớp lưu trữ chung: nó tự kiểm tra Keychain có thật trên máy này không
  // (bản IPA cũ chưa nhúng module native, hoặc máy mô phỏng không có Keychain)
  // rồi mới quyết định dùng Keychain hay kho dự phòng.
  return {
    getItem: (key: string) => getSecureStorage().then((store) => store.getItem(key)),
    setItem: (key: string, value: string) =>
      getSecureStorage().then((store) => store.setItem(key, value)),
    removeItem: (key: string) =>
      getSecureStorage().then((store) => store.removeItem(key)),
  };
}

let client: SupabaseClient | null = null;

/**
 * Client dùng chung. Trả về null khi chưa cấu hình — mọi chỗ gọi phải chịu được
 * null, vì ứng dụng vẫn phải chạy đầy đủ khi chưa đăng nhập.
 */
export function getCloudClient(): SupabaseClient | null {
  if (!cloudConfigured) return null;
  if (client) return client;
  // Chỉ tạo client khi thật sự có cấu hình: thiếu URL/key thì mọi lời gọi mạng
  // sẽ ném lỗi khó hiểu thay vì hiện màn hình cấu hình.


  client = createClient(CLOUD_URL, CLOUD_ANON_KEY, {
    auth: {
      storage: Platform.OS === 'web' ? webStorage : createSecureStoreAdapter(),
      persistSession: true,
      autoRefreshToken: true,
      // Không đọc token trên URL: liên kết email mở ở web admin panel, còn app
      // đăng nhập bằng email + mật khẩu.
      detectSessionInUrl: false,
      flowType: 'implicit',
    },
    global: {
      headers: { 'x-app-platform': Platform.OS },
    },
  });

  return client;
}

/** Buộc tạo lại client (dùng khi đăng xuất hẳn để xoá sạch phiên trong bộ nhớ). */
export function resetCloudClient(): void {
  client = null;
}

/**
 * Khoá lưu phiên của supabase-js: `sb-<project-ref>-auth-token` (và các mảnh
 * `.0`, `.1`… khi chuỗi bị chia nhỏ).
 */
function sessionKeys(): string[] {
  let ref = 'vocabmaster';
  try {
    ref = new URL(CLOUD_URL).hostname.split('.')[0] ?? ref;
  } catch {
    // URL hỏng thì vẫn còn danh sách rỗng bên dưới để dọn theo mẫu phổ biến.
  }
  const base = `sb-${ref}-auth-token`;
  return [base, ...Array.from({ length: 6 }, (_, index) => `${base}.${index}`)];
}

/**
 * Xoá phiên đã lưu trên máy.
 *
 * Dùng khi đăng xuất mà không gọi được server (mất mạng, token hỏng). Không có
 * bước này thì lần mở app sau token cũ vẫn còn và người dùng quay lại trạng
 * thái đã đăng nhập dù đã bấm Đăng xuất.
 */
export async function clearStoredSession(): Promise<void> {
  const adapter = Platform.OS === 'web' ? webStorage : createSecureStoreAdapter();
  const keys = sessionKeys();

  if (Platform.OS === 'web') {
    try {
      const storage = globalThis.localStorage;
      if (storage) {
        const stale: string[] = [];
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index);
          if (key && key.startsWith('sb-') && key.includes('auth-token')) stale.push(key);
        }
        for (const key of stale) storage.removeItem(key);
      }
    } catch {
      // Chế độ riêng tư chặn đọc: dùng danh sách key suy ra từ URL.
    }
  }

  for (const key of keys) {
    try {
      await adapter.removeItem(key);
    } catch {
      // Không xoá được thì bỏ qua: client mới sẽ không đọc ra phiên hợp lệ.
    }
  }
}

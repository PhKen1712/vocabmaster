/**
 * Cấu hình Supabase cho ứng dụng (iOS và web dùng chung file này).
 *
 * Hai giá trị dưới đây là CÔNG KHAI và được nhúng vào gói ứng dụng — đúng như
 * thiết kế của Supabase. Chúng không phải bí mật vì mọi quyền đều do Row Level
 * Security quyết định ở server. Tuyệt đối không đặt `service_role` ở đây.
 *
 * Lấy giá trị: Supabase → Project Settings → API
 *   EXPO_PUBLIC_SUPABASE_URL
 *   EXPO_PUBLIC_SUPABASE_ANON_KEY   (publishable/anon key)
 */

const url = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim();
const anonKey = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();

export const CLOUD_URL = url;
export const CLOUD_ANON_KEY = anonKey;

/**
 * Khi false, ứng dụng chạy y như trước: chỉ dùng SQLite trên máy, không có
 * màn hình đăng nhập, không gọi mạng. Học vẫn đầy đủ chức năng.
 */
export const cloudConfigured =
  /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) &&
  anonKey.length > 20 &&
  !anonKey.startsWith('sb_secret_');

/** Câu giải thích hiển thị trong Cài đặt khi chưa cấu hình. */
export const cloudConfigHint = cloudConfigured
  ? null
  : 'Chưa cấu hình Supabase. Điền EXPO_PUBLIC_SUPABASE_URL và EXPO_PUBLIC_SUPABASE_ANON_KEY vào file .env rồi khởi động lại.';

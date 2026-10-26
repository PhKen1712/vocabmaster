import { createClient } from '@supabase/supabase-js';

const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

/**
 * Nếu thiếu cấu hình thì nói rõ thiếu gì, thay vì để trang trắng hoặc lỗi
 * "Failed to fetch" khó hiểu. Không bao giờ in giá trị khoá ra giao diện.
 */
export const configProblem: string | null =
  !url || !anonKey
    ? 'Thiếu VITE_SUPABASE_URL hoặc VITE_SUPABASE_ANON_KEY. Copy admin/.env.example thành admin/.env rồi điền.'
    : !/^https:\/\/.+\.supabase\.co$/.test(url)
      ? `VITE_SUPABASE_URL không giống URL Supabase (${url}). Phải có dạng https://<ref>.supabase.co.`
      : anonKey.startsWith('sb_secret_')
        ? 'VITE_SUPABASE_ANON_KEY đang là secret key. Panel chỉ được dùng publishable/anon key; secret key lộ cho trình duyệt là mất toàn bộ database.'
        : null;

export const supabase = createClient(url || 'https://thieu-cau-hinh.supabase.co', anonKey || 'thieu-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

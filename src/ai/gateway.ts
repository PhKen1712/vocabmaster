import { getCloudClient } from '../cloud/client';
import { CLOUD_URL } from '../cloud/config';
import { loadProviderKey } from './provider';

/**
 * Chọn đường đi cho một lời gọi Groq.
 *
 * Hai chế độ, cùng một giao thức OpenAI:
 *
 * - `personal`: người học đã nhập key riêng. Gọi thẳng Groq từ thiết bị, như
 *   trước giờ. Key không đi qua máy chủ nào.
 * - `shared`: quản trị viên đã bật AI và cấu hình key chung trên server. App
 *   gọi Edge Function `ai-proxy`; function giữ key, kiểm tra tài khoản và hạn
 *   mức rồi mới gọi Groq. Key không bao giờ về trình duyệt/điện thoại.
 *
 * Key riêng luôn được ưu tiên: người đã tự cấu hình không bị đổi hành vi, và
 * hạn mức chung không bị tiêu bởi người có key riêng.
 */

export interface GroqAccess {
  mode: 'personal' | 'shared';
  /** Key Groq (personal) hoặc access token Supabase (shared). */
  token: string;
  /** Gốc URL; gọi thêm `/chat/completions` hoặc `/models`. */
  baseUrl: string;
  /** Model gửi kèm. Server có quyền ghi đè ở chế độ shared. */
  model: string;
}

const GROQ_BASE = 'https://api.groq.com/openai/v1';

interface SharedConfig {
  model: string;
}

let cachedShared: { at: number; value: SharedConfig | null } | null = null;
const SHARED_TTL_MS = 60_000;

async function loadSharedConfig(): Promise<SharedConfig | null> {
  if (cachedShared && Date.now() - cachedShared.at < SHARED_TTL_MS) return cachedShared.value;

  const client = getCloudClient();
  if (!client) return null;

  // Chỉ cache cấu hình (dùng chung cho mọi người), KHÔNG cache access token:
  // token phải đọc lại mỗi lần để đổi tài khoản/đăng xuất là hết hiệu lực ngay.
  const { data: sessionData } = await client.auth.getSession();
  if (!sessionData.session) return null;

  // `app_config` cho phép mọi tài khoản đã đăng nhập đọc các cột cấu hình; cột
  // chứa khoá đã bị thu hồi quyền đọc ở tầng database.
  const { data, error } = await client
    .from('app_config')
    .select('ai_enabled,ai_provider,ai_model')
    .eq('id', 1)
    .maybeSingle();

  if (error || !data) {
    cachedShared = { at: Date.now(), value: null };
    return null;
  }

  const row = data as { ai_enabled?: boolean; ai_provider?: string; ai_model?: string };
  if (!row.ai_enabled || row.ai_provider !== 'groq') {
    cachedShared = { at: Date.now(), value: null };
    return null;
  }

  const value: SharedConfig = {
    model: (row.ai_model ?? '').trim() || 'openai/gpt-oss-120b',
  };
  cachedShared = { at: Date.now(), value };
  return value;
}

/**
 * Trả về null khi không có cách nào gọi Groq (không có key riêng và server
 * chưa bật key chung). Caller phải báo đúng trạng thái đó, không được thử gọi
 * bằng key rỗng.
 */
export async function resolveGroqAccess(preferredModel?: string): Promise<GroqAccess | null> {
  const personal = (await loadProviderKey('groq'))?.trim();
  if (personal) {
    return {
      mode: 'personal',
      token: personal,
      baseUrl: GROQ_BASE,
      model: (preferredModel ?? '').trim() || 'openai/gpt-oss-120b',
    };
  }

  const shared = await loadSharedConfig();
  if (!shared || !CLOUD_URL) return null;

  const { data: sessionData } = await getCloudClient()!.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return null;

  return {
    mode: 'shared',
    token,
    baseUrl: `${CLOUD_URL}/functions/v1/ai-proxy`,
    model: (preferredModel ?? '').trim() || shared.model,
  };
}

/** Dùng sau khi đăng xuất/đổi tài khoản hoặc khi quản trị viên đổi cấu hình. */
export function resetGroqGateway(): void {
  cachedShared = null;
}

/**
 * Thông tin cho UI: có key riêng không, có AI chung không. Không trả nội dung
 * key, chỉ trạng thái.
 */
export async function describeGroqAccess(): Promise<{
  personal: boolean;
  shared: boolean;
  model: string | null;
}> {
  const personal = Boolean((await loadProviderKey('groq'))?.trim());
  const shared = await loadSharedConfig();
  return { personal, shared: Boolean(shared), model: shared?.model ?? null };
}

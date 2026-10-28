// ---------------------------------------------------------------------------
// ai-proxy · Cổng AI dùng chung
//
// Vì sao có function này: khoá Groq của quản trị viên không được nằm trên máy
// người học. App gửi yêu cầu tới đây kèm access token Supabase; function xác
// thực token, kiểm tra tài khoản còn hoạt động, trừ hạn mức trong ngày rồi mới
// gọi Groq bằng khoá phía server.
//
// Giao thức giữ nguyên kiểu OpenAI để phía app không phải viết lại parser:
//   POST <URL>/ai-proxy/chat/completions
//   POST <URL>/ai-proxy/models
//
// Biến môi trường (Supabase tự cấp): SUPABASE_URL, SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY. Khoá Groq lấy theo thứ tự:
//   1. secret GROQ_API_KEY của function (khuyến nghị khi cần tách khỏi DB)
//   2. cột app_config.ai_groq_key do admin panel ghi (không đọc được từ client)
// ---------------------------------------------------------------------------

import { createClient } from 'npm:@supabase/supabase-js@2';

const GROQ_BASE = 'https://api.groq.com/openai/v1';
const MAX_COMPLETION_TOKENS = 6_144;
const UPSTREAM_TIMEOUT_MS = 45_000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', ...extra },
  });
}

/** Lỗi theo đúng hình dạng Groq để app dùng lại bảng mã lỗi hiện có. */
function groqError(status: number, message: string): Response {
  return json(status, { error: { message, type: 'proxy_error' } });
}

function redact(value: string): string {
  return value.replace(/gsk_[A-Za-z0-9]{8,}/g, 'gsk_***');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const url = new URL(request.url);
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  if (!supabaseUrl || !anonKey || !serviceKey) {
    return groqError(500, 'Máy chủ chưa cấu hình đủ biến môi trường.');
  }

  const authorization = request.headers.get('Authorization') ?? '';
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!token) return groqError(401, 'Thiếu access token. Hãy đăng nhập lại.');

  // Xác thực token bằng anon key: không tin bất cứ user id nào do client gửi.
  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await authClient.auth.getUser(token);
  if (userError || !userData?.user) {
    return groqError(401, 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
  }
  const userId = userData.user.id;

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('status')
    .eq('user_id', userId)
    .maybeSingle();
  if (profileError) return groqError(503, 'Không kiểm tra được trạng thái tài khoản.');
  if (!profile || profile.status !== 'active') {
    return groqError(403, 'Tài khoản đang bị khoá.');
  }

  const { data: config, error: configError } = await admin
    .from('app_config')
    .select('ai_enabled, ai_provider, ai_model, ai_daily_limit, ai_groq_key')
    .eq('id', 1)
    .maybeSingle();
  if (configError) return groqError(503, 'Không đọc được cấu hình AI.');
  if (!config?.ai_enabled || config.ai_provider !== 'groq') {
    return groqError(403, 'Quản trị viên chưa bật AI dùng chung.');
  }

  const apiKey =
    (Deno.env.get('GROQ_API_KEY') ?? '').trim() || (config.ai_groq_key ?? '').trim();
  if (!apiKey) {
    return groqError(503, 'Chưa cấu hình khoá Groq trên máy chủ. Nhờ quản trị viên thêm khoá.');
  }

  const wantsModels = url.pathname.replace(/\/+$/, '').endsWith('/models');
  const target = wantsModels ? `${GROQ_BASE}/models` : `${GROQ_BASE}/chat/completions`;

  // Liệt kê model không tốn token nên không trừ hạn mức.
  if (!wantsModels) {
    const limit = Number(config.ai_daily_limit ?? 0);
    const { data: quota, error: quotaError } = await admin.rpc('ai_take_quota', {
      p_user_id: userId,
      p_limit: Number.isFinite(limit) ? limit : 0,
    });
    if (quotaError) return groqError(503, 'Không kiểm tra được hạn mức AI.');
    if (quota && quota.allowed === false) {
      return json(
        429,
        {
          error: {
            message: `Đã hết ${quota.limit} lượt AI hôm nay. Mai dùng tiếp hoặc nhập key Groq riêng trong Cài đặt.`,
            type: 'quota_exceeded',
          },
        },
        { 'retry-after': '3600' },
      );
    }
  }

  let upstreamBody: string | undefined;
  if (!wantsModels) {
    let parsed: Record<string, unknown>;
    try {
      parsed = (await request.json()) as Record<string, unknown>;
    } catch {
      return groqError(400, 'Nội dung yêu cầu không phải JSON.');
    }

    // Model do server quyết định: client không thể chọn model khác để né hạn mức.
    parsed.model = config.ai_model;
    const requestedTokens = Number(parsed.max_completion_tokens ?? 0);
    parsed.max_completion_tokens = Number.isFinite(requestedTokens)
      ? Math.min(Math.max(256, requestedTokens), MAX_COMPLETION_TOKENS)
      : MAX_COMPLETION_TOKENS;

    upstreamBody = JSON.stringify(parsed);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch(target, {
      method: wantsModels ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(wantsModels ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(upstreamBody ? { body: upstreamBody } : {}),
      signal: controller.signal,
    });

    const text = await upstream.text();

    if (!upstream.ok) {
      // Ghi lỗi để admin thấy trong tab AI; không ghi khoá hay nội dung prompt.
      await admin
        .rpc('ai_record_error', {
          p_user_id: userId,
          p_message: `HTTP ${upstream.status}: ${redact(text).slice(0, 300)}`,
        })
        .then(() => undefined, () => undefined);
    }

    const headers: Record<string, string> = {
      ...CORS,
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
    };
    const retryAfter = upstream.headers.get('retry-after');
    if (retryAfter) headers['retry-after'] = retryAfter;

    return new Response(text, { status: upstream.status, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await admin
      .rpc('ai_record_error', {
        p_user_id: userId,
        p_message: `proxy: ${redact(message).slice(0, 300)}`,
      })
      .then(() => undefined, () => undefined);
    return groqError(504, 'Groq không phản hồi kịp. Thử lại sau ít phút.');
  } finally {
    clearTimeout(timeout);
  }
});

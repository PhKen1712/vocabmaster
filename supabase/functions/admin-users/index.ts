/**
 * Edge Function: admin-users
 *
 * Vì sao phải có hàm này: tạo tài khoản / đặt lại mật khẩu / khoá người dùng
 * đều cần **service-role key**, thứ tuyệt đối không được nằm trong trình duyệt.
 * Panel chỉ gửi JWT của chính admin; hàm tự xác minh người gọi là admin *đang
 * active* rồi mới dùng khoá server.
 *
 * Triển khai: xem docs/CLOUD_BACKEND.md mục 14 (hoặc `npm run cloud:apply`).
 * Secret cần có (Supabase tự cấp, không cần đặt tay):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Gọi: POST /functions/v1/admin-users   { action, ... }
 *   { action: 'create', email, password, username }
 *   { action: 'lock', userId }
 *   { action: 'unlock', userId }
 *   { action: 'reset-password', userId, password }
 *   { action: 'whoami' }
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function textField(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

function passwordProblem(value: unknown): string | null {
  if (typeof value !== 'string') return 'Mật khẩu phải là chuỗi.';
  if (value.length < 8) return 'Mật khẩu phải có ít nhất 8 ký tự.';
  if (value.length > 72) return 'Mật khẩu không được dài quá 72 ký tự.';
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) return 'Mật khẩu phải có cả chữ và số.';
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'chỉ nhận POST' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return json({ error: 'thiếu cấu hình server' }, 500);

  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!jwt) return json({ error: 'thiếu phiên đăng nhập' }, 401);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Người gọi là ai (xác minh bằng JWT, không tin dữ liệu client gửi).
  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  if (userError || !userData?.user) return json({ error: 'phiên không hợp lệ' }, 401);
  const callerId = userData.user.id;

  // 2. Người gọi có phải admin đang active? Kiểm ở server, không dựa vào UI.
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('role, status, username')
    .eq('user_id', callerId)
    .maybeSingle();

  if (profileError) return json({ error: 'không đọc được hồ sơ' }, 500);
  if (!profile) return json({ error: 'chưa có hồ sơ' }, 403);
  if (profile.status !== 'active') return json({ error: 'tài khoản đang bị khoá' }, 403);
  if (profile.role !== 'admin') return json({ error: 'chỉ admin' }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'body không phải JSON' }, 400);
  }

  const action = textField(body.action, 40);

  try {
    if (action === 'whoami') {
      return json({ admin: profile.username, userId: callerId });
    }

    if (action === 'create') {
      const email = textField(body.email, 200);
      const username = textField(body.username, 60);
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'email không hợp lệ' }, 400);
      if (!username) return json({ error: 'tên đăng nhập không hợp lệ' }, 400);
      const pwProblem = passwordProblem(body.password);
      if (pwProblem) return json({ error: pwProblem }, 400);

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password: body.password as string,
        email_confirm: true,
        user_metadata: { username },
      });
      if (createError || !created?.user) {
        const message = createError?.message ?? 'không tạo được tài khoản';
        const friendly = /already|exists|registered/i.test(message)
          ? 'Email này đã được dùng cho một tài khoản khác.'
          : message;
        return json({ error: friendly }, 400);
      }

      // Trigger đã tạo profile; đặt username theo ý admin (không cho trùng).
      const { error: renameError } = await admin
        .from('profiles')
        .update({ username })
        .eq('user_id', created.user.id);
      if (renameError) {
        await admin.auth.admin.deleteUser(created.user.id);
        return json({ error: `Không đặt được tên đăng nhập: ${renameError.message}` }, 400);
      }

      return json({ userId: created.user.id, username, email }, 201);
    }

    if (action === 'lock' || action === 'unlock') {
      const userId = textField(body.userId, 40);
      if (!userId) return json({ error: 'thiếu userId' }, 400);
      if (userId === callerId) return json({ error: 'không tự khoá chính mình' }, 400);

      const status = action === 'lock' ? 'locked' : 'active';
      const { error: updateError } = await admin
        .from('profiles')
        .update({ status })
        .eq('user_id', userId);
      if (updateError) return json({ error: updateError.message }, 400);

      // Khoá phiên hiện có: nếu không, thiết bị đang đăng nhập vẫn gọi được
      // auth cho tới khi token hết hạn (dù RLS đã chặn ghi dữ liệu).
      if (status === 'locked') {
        await admin.auth.admin.updateUserById(userId, { ban_duration: '876000h' });
      } else {
        await admin.auth.admin.updateUserById(userId, { ban_duration: 'none' });
      }

      return json({ userId, status });
    }

    if (action === 'reset-password') {
      const userId = textField(body.userId, 40);
      if (!userId) return json({ error: 'thiếu userId' }, 400);
      const pwProblem = passwordProblem(body.password);
      if (pwProblem) return json({ error: pwProblem }, 400);

      const { error: resetError } = await admin.auth.admin.updateUserById(userId, {
        password: body.password as string,
      });
      if (resetError) return json({ error: resetError.message }, 400);
      return json({ userId, reset: true });
    }

    return json({ error: 'action không hợp lệ' }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'lỗi không xác định' }, 500);
  }
});

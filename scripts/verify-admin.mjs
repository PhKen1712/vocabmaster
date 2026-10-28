#!/usr/bin/env node
/**
 * Kiểm chứng phần quản trị bằng dữ liệu THẬT rồi dọn sạch.
 *
 * Trả lời đúng những câu không thể kiểm bằng cách đọc mã nguồn:
 *   1. Người dùng thường có gọi được hàm quản trị không? (phải bị chặn)
 *   2. Admin đặt streak xong, con số đọc lại có đúng không? (từng bị 0)
 *   3. Mốc điều chỉnh có tới được app qua `my_streak_baseline` không?
 *   4. Điều chỉnh streak có vô tình tạo giao dịch xu nào không?
 *   5. Khoá Groq dùng chung có bị đọc ra được qua REST không?
 *
 * Không in khoá, không in mật khẩu. Mọi tài khoản thử đều bị xoá ở cuối.
 *
 * Chạy: node scripts/verify-admin.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function readEnv(name) {
  const path = join(root, name);
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    out[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = readEnv('.env');
const cloud = readEnv('.env.cloud.local');
const URL_BASE = (env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '');
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const SERVICE = cloud.SUPABASE_SERVICE_ROLE_KEY ?? '';

const results = [];
const record = (ok, name, detail) => {
  results.push(ok);
  console.log(`${ok ? 'OK  ' : 'LỖI '} ${name.padEnd(46)} ${detail}`);
};

async function call(path, { method = 'GET', key = ANON, auth = key, body, prefer } = {}) {
  const headers = { apikey: key, Authorization: `Bearer ${auth}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${URL_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

const rpc = (fn, body, token) =>
  call(`/rest/v1/rpc/${fn}`, { method: 'POST', auth: token, body });

const suffix = Math.random().toString(36).slice(2, 8);
const password = `Tmp-${randomUUID()}`;
const admin = { email: `verify-admin-${suffix}@vocabmaster.test`, id: null, token: null };
const member = { email: `verify-member-${suffix}@vocabmaster.test`, id: null, token: null };

async function createUser(user, role) {
  const res = await call('/auth/v1/admin/users', {
    method: 'POST',
    key: SERVICE,
    auth: SERVICE,
    body: { email: user.email, password, email_confirm: true },
  });
  user.id = res.data?.id ?? res.data?.user?.id ?? null;
  if (!user.id) {
    record(false, `Tạo tài khoản ${role}`, `HTTP ${res.status} ${JSON.stringify(res.data).slice(0, 120)}`);
    return false;
  }
  if (role === 'admin') {
    const patched = await call(`/rest/v1/profiles?user_id=eq.${user.id}`, {
      method: 'PATCH',
      key: SERVICE,
      auth: SERVICE,
      body: { role: 'admin' },
      prefer: 'return=minimal',
    });
    record(patched.status === 204 || patched.status === 200, 'Cấp quyền admin (service role)', `HTTP ${patched.status}`);
  }
  return true;
}

async function signIn(user) {
  const res = await call('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email: user.email, password },
  });
  user.token = res.data?.access_token ?? null;
  return res.status === 200 && Boolean(user.token);
}

async function cleanup() {
  for (const user of [admin, member]) {
    if (user.id) await call(`/auth/v1/admin/users/${user.id}`, { method: 'DELETE', key: SERVICE, auth: SERVICE });
  }
}

async function main() {
  if (!URL_BASE || !ANON || !SERVICE) {
    console.error('Thiếu EXPO_PUBLIC_SUPABASE_URL/ANON_KEY (.env) hoặc SUPABASE_SERVICE_ROLE_KEY (.env.cloud.local).');
    process.exitCode = 1;
    return;
  }

  console.log(`\nQuản trị — kiểm chứng trên ${URL_BASE}\n${'='.repeat(64)}`);

  if (!(await createUser(member, 'member'))) return;
  if (!(await createUser(admin, 'admin'))) return;

  if (!(await signIn(member))) record(false, 'Thành viên đăng nhập', 'thất bại');
  if (!(await signIn(admin))) record(false, 'Admin đăng nhập', 'thất bại');
  record(Boolean(member.token && admin.token), 'Đăng nhập thật bằng mật khẩu', 'cả hai tài khoản');
  if (!member.token || !admin.token) return;

  // --- 1. Thành viên KHÔNG được chạm hàm quản trị ---------------------------
  const memberCalls = [
    ['admin_streak_info', { p_user_id: member.id }],
    ['admin_set_streak', { p_user_id: member.id, p_days: 30, p_reason: 'tự cấp cho mình' }],
    ['admin_groq_key_status', {}],
    ['admin_stats', {}],
    ['admin_accounts', { p_search: null, p_limit: 5, p_offset: 0 }],
  ];
  for (const [fn, body] of memberCalls) {
    const res = await rpc(fn, body, member.token);
    const denied = res.status === 401 || res.status === 403;
    record(denied, `Thành viên bị chặn: ${fn}`, `HTTP ${res.status}`);
  }

  // Không đọc được cột khoá Groq qua REST (kể cả khi đã đăng nhập).
  const keyLeak = await call('/rest/v1/app_config?select=ai_groq_key&id=eq.1', { auth: member.token });
  const leaked = Array.isArray(keyLeak.data) && keyLeak.data.some((row) => row?.ai_groq_key);
  record(!leaked, 'Không đọc được cột khoá Groq', `HTTP ${keyLeak.status}`);

  // --- 2. App đẩy một ngày đạt mục tiêu, admin phải thấy streak = 1 --------
  // Đây là chuỗi thật đã từng hỏng: app không gửi cờ goalMet nên panel luôn
  // đọc được 0 dù người học có ngày hoàn thành mục tiêu.
  const today = new Date().toISOString().slice(0, 10);
  const push = await rpc(
    'sync_push',
    {
      p_payload: {
        terms: [],
        user_words: [],
        reviews: [],
        daily_activity: [
          { day: today, newWords: 6, reviews: 4, answered: 10, correct: 9, goalMet: true },
        ],
        album: null,
        album_items: [],
        coins: [],
      },
      p_device_id: 'verify-admin',
      p_platform: 'verify-script',
      p_app_version: '0.1.0',
    },
    member.token,
  );
  record(push.status === 200, 'App gửi ngày đạt mục tiêu lên server', `HTTP ${push.status}`);

  const before = await rpc('admin_streak_info', { p_user_id: member.id }, admin.token);
  const beforeData = before.data ?? {};
  record(
    before.status === 200 && beforeData.current === 1,
    'Admin đọc streak từ ngày đạt mục tiêu',
    `HTTP ${before.status}, current=${beforeData.current}`,
  );

  // --- 3. Lý do ngắn bị từ chối -------------------------------------------
  const shortReason = await rpc('admin_set_streak', { p_user_id: member.id, p_days: 9, p_reason: 'ab' }, admin.token);
  record(shortReason.status >= 400, 'Từ chối lý do quá ngắn', `HTTP ${shortReason.status}`);

  // --- 4. Đặt streak và đọc lại -------------------------------------------
  const set = await rpc('admin_set_streak', { p_user_id: member.id, p_days: 5, p_reason: 'Kiểm chứng tự động: khôi phục chuỗi' }, admin.token);
  record(set.status === 200, 'Admin đặt streak = 5', `HTTP ${set.status}`);

  const after = await rpc('admin_streak_info', { p_user_id: member.id }, admin.token);
  const afterData = after.data ?? {};
  record(afterData.current === 5, 'Đọc lại đúng streak đã đặt', `current=${afterData.current}`);
  record(afterData.longest >= 5, 'Streak dài nhất được cập nhật', `longest=${afterData.longest}`);
  record(afterData.grant?.days === 5, 'Mốc điều chỉnh hiện hành', `grant.days=${afterData.grant?.days}`);
  record(
    Array.isArray(afterData.grants) && afterData.grants.length === 1 && afterData.grants[0].reason?.length > 3,
    'Nhật ký điều chỉnh có lý do + người thực hiện',
    `grants=${afterData.grants?.length}`,
  );

  // --- 5. App nhận được mốc qua my_streak_baseline -------------------------
  const baseline = await rpc('my_streak_baseline', {}, member.token);
  record(
    baseline.status === 200 && baseline.data?.days === 5 && typeof baseline.data?.date === 'string',
    'App đọc được mốc streak của chính mình',
    `days=${baseline.data?.days}, date=${baseline.data?.date}`,
  );

  // --- 6. Điều chỉnh streak không đẻ ra xu --------------------------------
  const coins = await call(`/rest/v1/coin_ledger?user_id=eq.${member.id}&select=id`, {
    key: SERVICE,
    auth: SERVICE,
  });
  record(Array.isArray(coins.data) && coins.data.length === 0, 'Không tự cộng xu khi sửa streak', `dòng xu=${coins.data?.length ?? '?'}`);

  // --- 7. Khoá Groq: chỉ trạng thái, không lộ giá trị ---------------------
  const keyStatus = await rpc('admin_groq_key_status', {}, admin.token);
  const statusText = JSON.stringify(keyStatus.data ?? {});
  record(keyStatus.status === 200, 'Admin đọc trạng thái khoá Groq', `HTTP ${keyStatus.status}`);
  record(!/gsk_[A-Za-z0-9]{20,}/.test(statusText), 'Phản hồi không chứa khoá Groq', 'không khớp mẫu gsk_');

  // --- 8. Edge Function ai-proxy: chặn người lạ, báo lỗi rõ ràng ----------
  const proxyNoAuth = await fetch(`${URL_BASE}/functions/v1/ai-proxy`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'ping' }] }),
    signal: AbortSignal.timeout(20_000),
  });
  record(proxyNoAuth.status === 401, 'ai-proxy chặn khi không có phiên', `HTTP ${proxyNoAuth.status}`);

  const keyConfigured = keyStatus.data?.configured === true;
  if (keyConfigured) {
    // Có thể là khoá thật của chủ dự án: TUYỆT ĐỐI không ghi đè hay xoá.
    record(true, 'Bỏ qua thử khoá giả (đang có khoá thật)', 'không ghi đè khoá của chủ dự án');
  } else {
    // Chỉ khi chưa có khoá mới dám thử khoá giả rồi xoá ngay.
    const fake = `gsk_${randomUUID().replace(/-/g, '')}`;
    const setFake = await rpc('admin_set_groq_key', { p_key: fake }, admin.token);
    record(setFake.status === 200, 'Admin lưu khoá Groq (bản thử)', `HTTP ${setFake.status}`);
    const masked = JSON.stringify(setFake.data ?? {});
    record(!masked.includes(fake), 'Khoá không bị trả về nguyên vẹn', 'chỉ có bản che');

    const proxyCall = await fetch(`${URL_BASE}/functions/v1/ai-proxy/chat/completions`, {
      method: 'POST',
      headers: { apikey: ANON, Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'ping' }] }),
      signal: AbortSignal.timeout(45_000),
    });
    record(
      proxyCall.status === 401 || proxyCall.status === 502,
      'ai-proxy gọi Groq và báo lỗi khoá sai',
      `HTTP ${proxyCall.status}`,
    );

    const clear = await rpc('admin_set_groq_key', { p_key: '' }, admin.token);
    const after = await rpc('admin_groq_key_status', {}, admin.token);
    record(
      clear.status === 200 && after.data?.configured === false,
      'Xoá khoá thử xong',
      `configured=${after.data?.configured}`,
    );
  }

  const summary = `${results.filter(Boolean).length}/${results.length} kiểm chứng đạt`;
  console.log('='.repeat(64));
  console.log(summary);
  if (results.some((ok) => !ok)) process.exitCode = 1;
}

try {
  await main();
} finally {
  await cleanup();
  console.log(`• Đã xoá tài khoản kiểm thử (${admin.email}, ${member.email})`);
}

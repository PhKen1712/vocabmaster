/**
 * Kiểm chứng backend bằng dữ liệu thật, không phải bằng niềm tin.
 *
 * Câu hỏi phải trả lời được (đúng những điểm tài liệu Supabase không nói rõ):
 *   1. Admin API còn tạo được tài khoản không? (kể cả khi đã tắt đăng ký công khai)
 *   2. Tài khoản tạo ra đăng nhập được ngay không?
 *   3. Người dùng A có đọc/ghi được dữ liệu của B không? (RLS)
 *   4. Gửi cùng một giao dịch xu hai lần có nhân đôi số dư không?
 *   5. Client có tự chèn vào sổ xu được không? (phải bị chặn)
 *   6. Tài khoản bị khoá có bị chặn ở server không?
 *
 * Mọi tài khoản/dữ liệu thử đều được xoá ở cuối. Không in khoá, không in mật khẩu.
 *
 * Chạy: npm run verify:cloud
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function readEnv(name) {
  const path = join(root, name);
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
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
  results.push({ ok, name, detail });
  console.log(`${ok ? 'OK  ' : 'LỖI '} ${name.padEnd(44)} ${detail}`);
};

function missingConfig() {
  if (!URL_BASE || !ANON) return 'thiếu EXPO_PUBLIC_SUPABASE_* trong .env';
  if (!SERVICE || SERVICE.includes('PASTE_')) return 'thiếu SUPABASE_SERVICE_ROLE_KEY trong .env.cloud.local';
  return null;
}

// apikey = khoá dự án (anon/service). Authorization = JWT của người dùng khi cần.
// Gửi JWT vào apikey sẽ bị gateway của khoá kiểu mới từ chối (401).
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
  return { status: res.status, data, headers: res.headers };
}

const suffix = Math.random().toString(36).slice(2, 8);
const password = `Tmp-${randomUUID()}`;
const userA = { email: `verify-a-${suffix}@vocabmaster.test`, password, id: null, token: null };
const userB = { email: `verify-b-${suffix}@vocabmaster.test`, password, id: null, token: null };
const termText = `verify ${suffix}`;
const sources = [];

async function createUser(u) {
  const res = await call('/auth/v1/admin/users', {
    method: 'POST',
    key: SERVICE, auth: SERVICE,
    body: { email: u.email, password: u.password, email_confirm: true },
  });
  if (res.status !== 200 && res.status !== 201) {
    record(false, 'Admin tạo tài khoản', `HTTP ${res.status} ${JSON.stringify(res.data).slice(0, 160)}`);
    return false;
  }
  u.id = res.data?.id ?? res.data?.user?.id ?? null;
  record(Boolean(u.id), 'Admin tạo tài khoản', `HTTP ${res.status} → id ${u.id ? u.id.slice(0, 8) + '…' : '?'}`);
  return Boolean(u.id);
}

async function signIn(u) {
  const res = await call('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email: u.email, password: u.password },
  });
  u.token = res.data?.access_token ?? null;
  record(res.status === 200 && Boolean(u.token), 'Đăng nhập bằng mật khẩu', `HTTP ${res.status}${u.token ? '' : ' (không có access_token)'}`);
  return Boolean(u.token);
}

async function cleanup() {
  // Xoá term dùng chung (cascade sang user_words/reviews/coin_ledger của 2 user thử).
  if (sources.length) {
    await call(`/rest/v1/coin_ledger?source_id=in.(${sources.join(',')})`, { method: 'DELETE', key: SERVICE, auth: SERVICE });
  }
  await call(`/rest/v1/terms?normalized=eq.${encodeURIComponent(termText)}`, { method: 'DELETE', key: SERVICE, auth: SERVICE });
  for (const u of [userA, userB]) {
    if (u.id) await call(`/auth/v1/admin/users/${u.id}`, { method: 'DELETE', key: SERVICE, auth: SERVICE });
  }
}

async function main() {
  const problem = missingConfig();
  if (problem) {
    record(false, 'Cấu hình', problem);
    return;
  }

  console.log(`\nKiểm chứng Supabase — ${URL_BASE}\n${'='.repeat(64)}`);

  // --- 1. Tài khoản ------------------------------------------------------
  if (!(await createUser(userA))) return;
  if (!(await createUser(userB))) return;
  const termCreatedEarly = await call('/rest/v1/terms?select=id&limit=1', { key: SERVICE, auth: SERVICE });
  record(termCreatedEarly.status === 200, 'Schema đã áp', `HTTP ${termCreatedEarly.status}${termCreatedEarly.status === 404 ? ' — chưa chạy supabase/migrations/0001_init.sql' : ''}`);
  if (termCreatedEarly.status !== 200) return;

  if (!(await signIn(userA))) return;
  if (!(await signIn(userB))) return;

  // Profile do trigger tạo, không do client.
  const prof = await call(`/rest/v1/profiles?select=user_id,role,status,username&user_id=eq.${userA.id}`, { key: ANON, auth: userA.token });
  const profileRow = Array.isArray(prof.data) ? prof.data[0] : null;
  record(prof.status === 200 && Boolean(profileRow), 'Trigger tạo profile', profileRow ? `role=${profileRow.role} status=${profileRow.status}` : `HTTP ${prof.status}`);

  // --- 2. Từ điển + tiến trình ------------------------------------------
  const termRes = await call('/rest/v1/terms?select=id,normalized,level', {
    method: 'POST',
    key: ANON, auth: userA.token,
    body: { term: termText, level: 1, level_source: 'ai' },
    prefer: 'return=representation',
  });
  const term = Array.isArray(termRes.data) ? termRes.data[0] : null;
  record(termRes.status === 201 && Boolean(term), 'Tạo từ trong từ điển', `HTTP ${termRes.status}${term ? ` normalized="${term.normalized}"` : ''}`);
  if (!term) return;

  const addWord = await call('/rest/v1/user_words', {
    method: 'POST',
    key: ANON, auth: userA.token,
    body: { user_id: userA.id, term_id: term.id, learning_state: 'learning', reps: 1 },
    prefer: 'return=minimal',
  });
  record(addWord.status === 201 || addWord.status === 204, 'A thêm từ vào kho cá nhân', `HTTP ${addWord.status}`);

  // --- 3. RLS: B không thấy dữ liệu của A -------------------------------
  const bSeesAll = await call('/rest/v1/user_words?select=user_id,term_id', { key: ANON, auth: userB.token });
  const bRows = Array.isArray(bSeesAll.data) ? bSeesAll.data : [];
  record(
    bSeesAll.status === 200 && bRows.length === 0,
    'B không đọc được kho của A',
    `HTTP ${bSeesAll.status}, thấy ${bRows.length} dòng`,
  );

  const bForced = await call(`/rest/v1/user_words?select=*&user_id=eq.${userA.id}`, { key: ANON, auth: userB.token });
  const bForcedRows = Array.isArray(bForced.data) ? bForced.data : [];
  record(bForcedRows.length === 0, 'B lọc theo user_id của A → rỗng', `${bForcedRows.length} dòng`);

  const bWrite = await call('/rest/v1/user_words', {
    method: 'POST',
    key: ANON, auth: userB.token,
    body: { user_id: userA.id, term_id: term.id, reps: 99 },
  });
  record(bWrite.status === 403 || bWrite.status === 401, 'B không ghi được vào kho của A', `HTTP ${bWrite.status}`);

  const bReadsAProfile = await call(`/rest/v1/profiles?select=user_id&user_id=eq.${userA.id}`, { key: ANON, auth: userB.token });
  const leaked = Array.isArray(bReadsAProfile.data) ? bReadsAProfile.data.length : 0;
  record(leaked === 0, 'B không đọc được profile của A', `${leaked} dòng`);

  // --- 4. Xu: idempotent -------------------------------------------------
  const sourceId = `verify-${suffix}-1`;
  sources.push(sourceId);
  const first = await call('/rest/v1/rpc/award_coins', {
    method: 'POST',
    key: ANON, auth: userA.token,
    body: { p_kind: 'reward', p_amount: 10, p_source_id: sourceId, p_reason: 'kiểm thử' },
  });
  const second = await call('/rest/v1/rpc/award_coins', {
    method: 'POST',
    key: ANON, auth: userA.token,
    body: { p_kind: 'reward', p_amount: 10, p_source_id: sourceId, p_reason: 'kiểm thử' },
  });
  record(
    first.status === 200 && second.status === 200 && first.data?.id === second.data?.id,
    'Gửi lại cùng source_id → cùng giao dịch',
    `HTTP ${first.status}/${second.status}${first.data?.id ? ` id ${String(first.data.id).slice(0, 8)}…` : ''}`,
  );

  const balance = await call('/rest/v1/rpc/my_coin_balance', { method: 'POST', key: ANON, auth: userA.token, body: {} });
  record(balance.data === 10, 'Số dư chỉ cộng một lần', `balance=${JSON.stringify(balance.data)} (mong đợi 10)`);

  // Hai request song song cùng source_id: vẫn chỉ một dòng.
  const parallelId = `verify-${suffix}-2`;
  sources.push(parallelId);
  const parallel = await Promise.all(
    [1, 2, 3].map(() =>
      call('/rest/v1/rpc/award_coins', {
        method: 'POST',
        key: ANON, auth: userA.token,
        body: { p_kind: 'reward', p_amount: 5, p_source_id: parallelId, p_reason: 'song song' },
      }),
    ),
  );
  const ids = new Set(parallel.filter((r) => r.status === 200).map((r) => r.data?.id));
  record(ids.size === 1 && parallel.every((r) => r.status === 200), '3 request song song → 1 giao dịch', `${ids.size} id khác nhau`);

  const balance2 = await call('/rest/v1/rpc/my_coin_balance', { method: 'POST', key: ANON, auth: userA.token, body: {} });
  record(balance2.data === 15, 'Số dư đúng sau 3 request song song', `balance=${JSON.stringify(balance2.data)} (mong đợi 15)`);

  // --- 5. Client không tự chèn sổ xu ------------------------------------
  const directLedger = await call('/rest/v1/coin_ledger', {
    method: 'POST',
    key: ANON, auth: userA.token,
    body: { user_id: userA.id, kind: 'reward', amount: 9999, balance_after: 9999, source_id: `cheat-${suffix}` },
  });
  record(directLedger.status === 403 || directLedger.status === 401, 'Client không chèn thẳng được vào sổ xu', `HTTP ${directLedger.status}`);

  // --- 6. Tự phong admin ------------------------------------------------
  const selfPromote = await call(`/rest/v1/profiles?user_id=eq.${userA.id}`, {
    method: 'PATCH',
    key: ANON, auth: userA.token,
    body: { role: 'admin' },
    prefer: 'return=representation',
  });
  const promoted = Array.isArray(selfPromote.data) ? selfPromote.data.some((r) => r.role === 'admin') : false;
  record(!promoted, 'Không tự nâng mình thành admin', `HTTP ${selfPromote.status}${promoted ? ' — NGUY HIỂM: đã đổi được' : ''}`);

  // --- 7. Tài khoản bị khoá ---------------------------------------------
  await call(`/rest/v1/profiles?user_id=eq.${userB.id}`, {
    method: 'PATCH',
    key: SERVICE, auth: SERVICE,
    body: { status: 'locked' },
  });
  const lockedWrite = await call('/rest/v1/user_words', {
    method: 'POST',
    key: ANON, auth: userB.token,
    body: { user_id: userB.id, term_id: term.id, reps: 1 },
  });
  record(lockedWrite.status === 403 || lockedWrite.status === 401, 'Tài khoản bị khoá bị chặn khi ghi', `HTTP ${lockedWrite.status}`);

  const lockedReview = await call('/rest/v1/reviews', {
    method: 'POST',
    key: ANON, auth: userB.token,
    body: { id: randomUUID(), user_id: userB.id, term_id: term.id, rating: 'good' },
  });
  record(lockedReview.status === 403 || lockedReview.status === 401, 'Tài khoản bị khoá không ghi được lượt ôn', `HTTP ${lockedReview.status}`);
}

try {
  await main();
} catch (error) {
  record(false, 'Ngoại lệ', `${error.name}: ${error.message}`);
} finally {
  try {
    await cleanup();
  } catch {
    /* dọn dẹp là best-effort */
  }
  const okCount = results.filter((r) => r.ok).length;
  console.log('='.repeat(64));
  console.log(`${okCount}/${results.length} mục đạt. Dữ liệu thử đã được xoá.\n`);
  process.exitCode = results.length > 0 && results.every((r) => r.ok) ? 0 : 1;
}

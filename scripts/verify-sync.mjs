#!/usr/bin/env node
/**
 * Kiểm chứng tầng đồng bộ bằng dữ liệu THẬT (rồi dọn sạch).
 *
 * Việc nó làm, theo thứ tự:
 *   1. Tạo một tài khoản kiểm thử (email dùng-một-lần, mật khẩu sinh ngẫu nhiên).
 *   2. Đăng nhập bằng chính khoá publishable mà app dùng → lấy JWT thật.
 *   3. sync_push một gói dữ liệu mẫu (từ, tiến độ, lượt ôn, hoạt động, album, xu, cài đặt).
 *   4. sync_push LẦN HAI y hệt → khẳng định không sinh thêm dòng nào (chống trùng).
 *   5. sync_pull → khẳng định dữ liệu quay về đúng, đúng chủ sở hữu.
 *   6. reset_study_progress → tiến độ về 0, từ điển và xu còn nguyên.
 *   7. Xoá tài khoản kiểm thử và các từ kiểm thử. Không để lại rác.
 *
 * Chạy: npm run verify:sync
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const url = env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = cloud.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  console.error('Thiếu cấu hình: cần EXPO_PUBLIC_SUPABASE_URL/ANON_KEY (.env) và SUPABASE_SERVICE_ROLE_KEY (.env.cloud.local).');
  process.exit(1);
}

const results = [];
function report(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function rest(path, { method = 'GET', body, token = serviceKey, prefer } = {}) {
  const response = await fetch(`${url}${path}`, {
    method,
    headers: {
      apikey: method === 'GET' || method === 'POST' ? anonKey : anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: response.ok, status: response.status, data };
}

async function rpc(name, args, token = serviceKey) {
  return rest(`/rest/v1/rpc/${name}`, { method: 'POST', body: args, token });
}

async function adminApi(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${url}${path}`, {
    method,
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: response.ok, status: response.status, data };
}

const randomSuffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const testEmail = `sync-check-${randomSuffix}@example.com`;
const testPassword = `Sync-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}!`;
const terms = [`zzsyncalpha${randomSuffix.slice(-4)}`, `zzsyncbeta${randomSuffix.slice(-4)}`];
const deviceId = `verify-${randomSuffix}`;

let userId = null;
let albumClientId = `album-${randomSuffix}`;

async function cleanup() {
  if (userId) {
    await adminApi(`/auth/v1/admin/users/${userId}`, { method: 'DELETE' });
    console.log(`• Đã xoá tài khoản kiểm thử ${testEmail}`);
  }
  const removed = await rest(`/rest/v1/terms?normalized=in.(${terms.map((t) => t.toLowerCase()).join(',')})`, {
    method: 'DELETE',
  });
  if (removed.ok) console.log('• Đã xoá các từ kiểm thử khỏi từ điển dùng chung');
}

try {
  console.log(`\nĐồng bộ — kiểm chứng trên ${url.replace(/^https:\/\//, '').split('.')[0]}…\n${'='.repeat(56)}`);

  // ---------------------------------------------------------------- 1
  const created = await adminApi('/auth/v1/admin/users', {
    method: 'POST',
    body: { email: testEmail, password: testPassword, email_confirm: true, user_metadata: { username: `sync-${randomSuffix.slice(-6)}` } },
  });
  if (!created.ok) throw new Error(`Không tạo được tài khoản kiểm thử: ${JSON.stringify(created.data).slice(0, 200)}`);
  userId = created.data.id;
  report('Tạo tài khoản kiểm thử', true, `id ${userId.slice(0, 8)}…`);

  // ---------------------------------------------------------------- 2
  const login = await rest('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email: testEmail, password: testPassword },
    token: anonKey,
  });
  const jwt = login.data?.access_token;
  report('Đăng nhập bằng khoá công khai (như app)', Boolean(jwt), jwt ? `JWT ${String(jwt).length} ký tự` : `HTTP ${login.status}`);
  if (!jwt) throw new Error('Không đăng nhập được, dừng kiểm chứng.');

  // ---------------------------------------------------------------- 3
  const payload = {
    terms: terms.map((term, index) => ({
      term,
      meaningVi: `nghĩa kiểm thử ${index + 1}`,
      definitionEn: `definition ${index + 1}`,
      ipa: '',
      partOfSpeech: 'noun',
      exampleEn: `example with ${term}`,
      exampleVi: `ví dụ với ${term}`,
      synonyms: ['alpha'],
      antonyms: [],
      collocations: ['test collocation'],
      wordFamilyText: `${term}ly`,
      level: 3,
      levelSource: 'ai',
      source: 'ai',
      aiGenerated: true,
    })),
    user_words: terms.map((term, index) => ({
      term,
      learningState: index === 0 ? 'learning' : 'review',
      dueAt: new Date(Date.now() + 3600_000).toISOString(),
      stability: 1.5,
      difficulty: 5,
      reps: 2,
      lapses: 1,
      correctCount: 3,
      wrongCount: 1,
      hintCount: 1,
      lastCorrectAt: new Date().toISOString(),
      lastWrongAt: new Date().toISOString(),
      memoryRating: index === 0 ? 2 : 4,
      isFavorite: index === 0,
      updatedAt: new Date().toISOString(),
    })),
    reviews: [
      {
        id: crypto.randomUUID(),
        term: terms[0],
        rating: 3,
        correct: true,
        mode: 'quiz',
        cycleId: 'cycle-check-1',
        reviewedAt: new Date().toISOString(),
      },
    ],
    daily_activity: [
      {
        day: new Date().toISOString().slice(0, 10),
        newWords: 2,
        reviews: 1,
        answered: 1,
        correct: 1,
        // Cờ này là thứ bảng quản trị dùng để biết ngày đã đạt mục tiêu.
        goalMet: true,
      },
    ],
    album: { clientId: albumClientId, name: 'Album kiểm thử', notifyEnabled: true, intervalMinutes: 45, startHour: 7, endHour: 21 },
    album_items: [
      { term: terms[0], addedAt: new Date().toISOString(), deletedAt: null, notifyCount: 1, lastNotifiedAt: new Date().toISOString() },
      { term: terms[1], addedAt: new Date().toISOString(), deletedAt: null, notifyCount: 0, lastNotifiedAt: null },
    ],
    study_cycles: [{ id: 'cycle-check-1', startedAt: new Date().toISOString(), reason: 'kiểm thử' }],
    coins: [{ amount: 5, sourceId: `verify-coin-${randomSuffix}`, reason: 'kiểm thử đồng bộ', cycleId: 'cycle-check-1' }],
    settings: { track: 'general', level: 3, verifyMarker: randomSuffix },
  };

  const push1 = await rpc('sync_push', { p_payload: payload, p_device_id: deviceId, p_platform: 'verify-script', p_app_version: '0.1.0' }, jwt);
  const push1Ok = push1.ok && push1.data?.ok === true;
  report('sync_push lần đầu', push1Ok, push1Ok ? `đã áp ${JSON.stringify(push1.data.applied)}` : `HTTP ${push1.status} ${JSON.stringify(push1.data).slice(0, 160)}`);
  if (!push1Ok) throw new Error('sync_push lần đầu thất bại.');

  const termIds = push1.data.terms ?? {};
  report('Trả về id từ cho từng mục', Object.keys(termIds).length === 2, Object.keys(termIds).join(', '));

  // ---------------------------------------------------------------- 4 chống trùng
  const push2 = await rpc('sync_push', { p_payload: payload, p_device_id: deviceId, p_platform: 'verify-script', p_app_version: '0.1.0' }, jwt);
  report('sync_push lần hai (gửi lại y hệt)', push2.ok, `HTTP ${push2.status}`);

  const counts = await Promise.all([
    rest(`/rest/v1/user_words?select=term_id`, { token: jwt }),
    rest(`/rest/v1/reviews?select=id`, { token: jwt }),
    rest(`/rest/v1/coin_ledger?select=id,amount,balance_after`, { token: jwt }),
    rest(`/rest/v1/daily_activity?select=day,goal_met`, { token: jwt }),
    rest(`/rest/v1/album_items?select=term_id`, { token: jwt }),
    rest(`/rest/v1/albums?select=id,client_id,interval_minutes`, { token: jwt }),
  ]);
  const [words, reviews, coins, activity, albumItems, albums] = counts.map((r) => r.data);
  const noDuplicates =
    words?.length === 2 && reviews?.length === 1 && coins?.length === 1 && activity?.length === 1 && albumItems?.length === 2 && albums?.length === 1;
  report(
    'Không nhân đôi sau khi gửi lại',
    noDuplicates,
    `từ=${words?.length} lượt ôn=${reviews?.length} xu=${coins?.length} ngày=${activity?.length} album_items=${albumItems?.length} album=${albums?.length}`,
  );
  report('Số dư xu tính ở server', coins?.[0]?.balance_after === 5, `balance_after=${coins?.[0]?.balance_after}`);
  report(
    'Ngày đạt mục tiêu được lưu lên server',
    activity?.[0]?.goal_met === true,
    `goal_met=${activity?.[0]?.goal_met}`,
  );

  // ---------------------------------------------------------------- 5 pull
  const pull = await rpc('sync_pull', { p_since: null }, jwt);
  const pulled = pull.data ?? {};
  const pulledTerms = (pulled.words ?? []).map((w) => w.term).sort();
  report('sync_pull trả về dữ liệu vừa đẩy', pull.ok && pulledTerms.join(',') === [...terms].sort().join(','), pulledTerms.join(', '));
  report(
    'Pull giữ nguyên tiến độ và lịch ôn',
    (pulled.words ?? [])[0]?.correctCount === 3 && (pulled.words ?? [])[0]?.dueAt !== null,
    `correctCount=${(pulled.words ?? [])[0]?.correctCount}`,
  );
  report('Pull có số dư xu', typeof pulled.balance === 'number' && pulled.balance >= 5, `balance=${pulled.balance}`);
  report('Pull có cài đặt cá nhân', pulled.settings?.verifyMarker === randomSuffix, `marker=${pulled.settings?.verifyMarker}`);

  // ---------------------------------------------------------------- 6 reset
  const reset = await rpc('reset_study_progress', { p_reason: 'kiểm thử' }, jwt);
  const afterReset = await rest(`/rest/v1/user_words?select=correct_count,wrong_count,learning_state,due_at&order=correct_count.asc`, { token: jwt });
  const rows = afterReset.data ?? [];
  report(
    'reset_study_progress đưa tiến độ về chưa học',
    reset.ok && rows.length === 2 && rows.every((r) => r.correct_count === 0 && r.wrong_count === 0 && r.learning_state === 'new' && r.due_at === null),
    `rows=${rows.length}`,
  );
  const coinsAfter = await rest(`/rest/v1/coin_ledger?select=amount`, { token: jwt });
  report('Reset KHÔNG đụng tới số dư xu', (coinsAfter.data ?? []).length === 1, `sổ xu còn ${(coinsAfter.data ?? []).length} dòng`);

  // ---------------------------------------------------------------- 7 cách ly
  const otherUser = await adminApi('/auth/v1/admin/users', {
    method: 'POST',
    body: { email: `sync-other-${randomSuffix}@example.com`, password: testPassword, email_confirm: true },
  });
  if (otherUser.ok) {
    const otherLogin = await rest('/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: { email: `sync-other-${randomSuffix}@example.com`, password: testPassword },
      token: anonKey,
    });
    const otherJwt = otherLogin.data?.access_token;
    const otherWords = await rest('/rest/v1/user_words?select=term_id', { token: otherJwt });
    const otherPull = await rpc('sync_pull', { p_since: null }, otherJwt);
    report(
      'Tài khoản khác KHÔNG thấy dữ liệu này',
      (otherWords.data ?? []).length === 0 && (otherPull.data?.words ?? []).length === 0,
      `user_words=${(otherWords.data ?? []).length}, pull words=${(otherPull.data?.words ?? []).length}`,
    );
    await adminApi(`/auth/v1/admin/users/${otherUser.data.id}`, { method: 'DELETE' });
  } else {
    report('Tài khoản khác KHÔNG thấy dữ liệu này', false, 'không tạo được tài khoản đối chứng');
  }
} catch (error) {
  report('Kiểm chứng', false, error.message);
} finally {
  await cleanup();
}

const failed = results.filter((r) => !r.ok);
console.log(`${'='.repeat(56)}`);
console.log(`${results.length - failed.length}/${results.length} kiểm chứng đạt`);
if (failed.length > 0) {
  console.log('\nKhông đạt:');
  for (const item of failed) console.log(` - ${item.name}: ${item.detail}`);
  process.exitCode = 1;
}

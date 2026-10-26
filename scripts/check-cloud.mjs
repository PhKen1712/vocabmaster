/**
 * Kiểm tra nhanh cấu hình Supabase trước khi viết code đồng bộ.
 *
 * Nguyên tắc: chỉ IN TRẠNG THÁI, không bao giờ in giá trị khoá. Mục đích là biết
 * "khoá đã dán chưa / có gõ nhầm không / sai project không" trong vài giây, thay
 * vì để lỗi 401 hiện ra giữa lúc debug tính năng.
 *
 * Chạy: npm run check:cloud
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function readEnvFile(name) {
  const path = join(root, name);
  if (!existsSync(path)) return { exists: false, values: {} };
  const values = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    values[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  return { exists: true, values };
}

const rows = [];
const fail = (name, detail) => rows.push({ ok: false, name, detail });
const pass = (name, detail) => rows.push({ ok: true, name, detail });

function keyKind(value) {
  if (!value) return 'trống';
  if (value.includes('PASTE_')) return 'chưa điền (còn chữ PASTE_)';
  if (value.startsWith('sb_publishable_')) return 'publishable (kiểu mới)';
  if (value.startsWith('sb_secret_')) return 'secret (kiểu mới)';
  if (value.startsWith('eyJ')) return 'JWT (anon/service_role kiểu cũ)';
  return 'không nhận dạng được';
}

const env = readEnvFile('.env');
const cloud = readEnvFile('.env.cloud.local');

const url = env.values.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anon = env.values.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const service = cloud.values.SUPABASE_SERVICE_ROLE_KEY ?? '';

// --- .env ---------------------------------------------------------------
if (!env.exists) {
  fail('.env', 'không thấy file');
} else {
  let host = null;
  try {
    const parsed = new URL(url);
    host = parsed.host;
    const looksRight = parsed.protocol === 'https:' && /^[a-z0-9-]+\.supabase\.co$/.test(parsed.host);
    looksRight
      ? pass('EXPO_PUBLIC_SUPABASE_URL', `hợp lệ → ${host}`)
      : fail('EXPO_PUBLIC_SUPABASE_URL', `không giống URL Supabase (${host}) — phải là https://<ref>.supabase.co`);
  } catch {
    fail('EXPO_PUBLIC_SUPABASE_URL', `không phải URL: ${keyKind(url)}`);
  }

  const kind = keyKind(anon);
  kind.startsWith('không nhận dạng') || kind.startsWith('chưa điền') || kind === 'trống'
    ? fail('EXPO_PUBLIC_SUPABASE_ANON_KEY', kind)
    : pass('EXPO_PUBLIC_SUPABASE_ANON_KEY', `${kind}, dài ${anon.length} ký tự`);
}

// --- .env.cloud.local ---------------------------------------------------
if (!cloud.exists) {
  fail('.env.cloud.local', 'không thấy file');
} else {
  const kind = keyKind(service);
  kind.startsWith('không nhận dạng') || kind.startsWith('chưa điền') || kind === 'trống'
    ? fail('SUPABASE_SERVICE_ROLE_KEY', `${kind} — chưa dán`)
    : pass('SUPABASE_SERVICE_ROLE_KEY', `${kind}, dài ${service.length} ký tự`);
}

// --- Gọi thử mạng (chỉ khi URL + anon key nhìn hợp lệ) -------------------
const hasUrl = rows.some((r) => r.ok && r.name === 'EXPO_PUBLIC_SUPABASE_URL');
const hasAnon = rows.some((r) => r.ok && r.name === 'EXPO_PUBLIC_SUPABASE_ANON_KEY');

async function status(path, key) {
  try {
    const res = await fetch(new URL(path, url).toString(), {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(12_000),
    });
    return res.status;
  } catch {
    return 0;
  }
}

if (hasUrl && hasAnon) {
  const health = await status('/auth/v1/health', anon);
  health === 200 ? pass('Auth API', 'HTTP 200 — project sống') : fail('Auth API', `HTTP ${health}`);

  // Đã kiểm bằng đối chứng: khoá thật trên bảng chưa tồn tại → 404, khoá giả → 401.
  // Nên 404 ở đây là "khoá được chấp nhận", 401 mới là sai khoá. Endpoint gốc
  // /rest/v1/ trả 401 cho CẢ hai loại khoá (quirk, không dùng để kiểm).
  const real = await status('/rest/v1/__chua_tao__?select=*', anon);
  const fake = await status('/rest/v1/__chua_tao__?select=*', 'sb_publishable_khoa-gia-mao-kiem-doi-chung');

  if (real === 401) fail('REST API', `HTTP 401 với khoá thật → khoá sai hoặc đã bị thu hồi`);
  else if (real === 0) fail('REST API', 'không kết nối được (mạng/firewall)');
  else pass('REST API', `HTTP ${real} với khoá thật → khoá được chấp nhận`);

  // Đối chứng ngược: nếu khoá giả cũng không bị chặn thì phép thử trên vô nghĩa.
  fake === 401
    ? pass('Đối chứng khoá giả', 'HTTP 401 — gateway thật sự kiểm khoá')
    : fail('Đối chứng khoá giả', `HTTP ${fake} thay vì 401 — phép thử REST ở trên không đáng tin`);

  // Khoá service-role chỉ có ý nghĩa nếu nó thật sự mở được endpoint admin.
  // Đây cũng là endpoint mà admin panel sẽ dùng để tạo tài khoản.
  if (service && !service.includes('PASTE_')) {
    const admin = await status('/auth/v1/admin/users?per_page=1', service);
    admin === 200
      ? pass('Service key', 'HTTP 200 trên /auth/v1/admin/users — quyền admin thật')
      : fail('Service key', `HTTP ${admin} trên endpoint admin — sai khoá hoặc đã bị thu hồi`);
  }
}

// --- Báo cáo ------------------------------------------------------------
const okCount = rows.filter((r) => r.ok).length;
console.log('\nKiểm tra cấu hình Supabase\n' + '='.repeat(52));
for (const row of rows) console.log(`${row.ok ? 'OK  ' : 'LỖI '} ${row.name.padEnd(34)} ${row.detail}`);
console.log('='.repeat(52));
console.log(`${okCount}/${rows.length} mục đạt.\n`);
process.exitCode = rows.every((r) => r.ok) ? 0 : 1;

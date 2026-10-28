/**
 * Áp migration + deploy Edge Function qua Supabase Management API.
 *
 * Dùng khi không muốn copy/paste SQL vào Dashboard. Cần một Personal Access Token
 * (Supabase → Account → Access Tokens) đặt trong `.env.cloud.local`:
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_...
 *
 * Token này có quyền quản trị project — đối xử như mật khẩu, đừng commit, đừng
 * dán vào chat. Thu hồi được bất cứ lúc nào ở cùng trang đã tạo.
 *
 * Endpoint (đã đối chiếu tài liệu Supabase):
 *   POST https://api.supabase.com/v1/projects/{ref}/database/query   { query }
 *   POST https://api.supabase.com/v1/projects/{ref}/functions/deploy?slug=...
 *        multipart: metadata={entrypoint_path,name} + file=<mã nguồn>
 *
 * Chạy:
 *   npm run cloud:apply                       # migration rồi tới function
 *   npm run cloud:apply -- --sql              # chỉ migration
 *   npm run cloud:apply -- --functions        # chỉ function
 *   npm run cloud:apply -- --sql --only=0006  # chỉ file migration khớp chuỗi
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.supabase.com/v1';

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
const token = cloud.SUPABASE_ACCESS_TOKEN ?? '';
const projectUrl = env.EXPO_PUBLIC_SUPABASE_URL ?? '';

const ref = (() => {
  try {
    return new URL(projectUrl).host.split('.')[0];
  } catch {
    return '';
  }
})();

if (!token || token.includes('PASTE_')) {
  console.error('Thiếu SUPABASE_ACCESS_TOKEN trong .env.cloud.local (Supabase → Account → Access Tokens).');
  process.exit(1);
}
if (!token.startsWith('sbp_')) {
  console.error('SUPABASE_ACCESS_TOKEN không giống token Supabase (phải bắt đầu bằng "sbp_").');
  process.exit(1);
}
if (!ref) {
  console.error('Không đọc được project ref từ EXPO_PUBLIC_SUPABASE_URL trong .env.');
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
const only = [...args].find((arg) => arg.startsWith('--only='))?.slice('--only='.length) ?? null;
const doSql = args.has('--sql') || (!args.has('--functions') && !only);
const doFunctions = args.has('--functions') || (args.size === 0);

const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

async function runQuery(name, sql) {
  const res = await fetch(`${API}/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const detail =
      (body && (body.message || body.error || body.msg)) || (typeof body === 'string' ? body : JSON.stringify(body));
    throw new Error(`${name}: HTTP ${res.status} — ${String(detail).slice(0, 400)}`);
  }
  const rows = Array.isArray(body) ? body.length : null;
  console.log(`OK   ${name}${rows !== null ? ` (${rows} dòng trả về)` : ''}`);
}

async function deployFunction(slug, sourcePath) {
  const source = readFileSync(sourcePath, 'utf8');
  const form = new FormData();
  form.append('metadata', JSON.stringify({ entrypoint_path: 'index.ts', name: slug }));
  form.append('file', new Blob([source], { type: 'application/typescript' }), 'index.ts');

  const res = await fetch(`${API}/projects/${ref}/functions/deploy?slug=${encodeURIComponent(slug)}`, {
    method: 'POST',
    headers,
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const detail = (body && (body.message || body.error)) || (typeof body === 'string' ? body : JSON.stringify(body));
    throw new Error(`${slug}: HTTP ${res.status} — ${String(detail).slice(0, 400)}`);
  }
  const version = body?.version ?? body?.id ?? '?';
  console.log(`OK   function ${slug} (version ${String(version).slice(0, 12)})`);
}

async function main() {
  console.log(`\nProject: ${ref}\n${'='.repeat(52)}`);

  if (doSql) {
    const dir = join(root, 'supabase', 'migrations');
    const files = existsSync(dir)
      ? readdirSync(dir)
          .filter((f) => f.endsWith('.sql') && (!only || f.includes(only)))
          .sort()
      : [];
    if (files.length === 0) console.log('(không có file migration nào)');
    for (const file of files) {
      await runQuery(file, readFileSync(join(dir, file), 'utf8'));
    }
  }

  if (doFunctions) {
    const base = join(root, 'supabase', 'functions');
    const dirs = existsSync(base)
      ? readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory())
      : [];
    if (dirs.length === 0) console.log('(không có function nào)');
    for (const entry of dirs) {
      const source = join(base, entry.name, 'index.ts');
      if (!existsSync(source)) continue;
      await deployFunction(entry.name, source);
    }
  }

  console.log(`${'='.repeat(52)}\nXong. Chạy tiếp: npm run verify:cloud\n`);
}

main().catch((error) => {
  console.error(`\nLỖI: ${error.message}\n`);
  process.exitCode = 1;
});

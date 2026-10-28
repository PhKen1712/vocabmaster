#!/usr/bin/env node
/**
 * Đóng gói admin panel (Vite build) thành gói deploy tĩnh cho Freebuff Sites.
 *
 * Vì sao cần kiểm tra `supabase.co` trong bundle: admin panel là ứng dụng đọc
 * cấu hình lúc BUILD. Nếu file `admin/.env` thiếu, trang vẫn deploy thành công
 * nhưng mở ra chỉ thấy "Thiếu VITE_SUPABASE_URL…" — đúng kiểu lỗi "panel không
 * kết nối được". Script này chặn việc deploy một bản build như vậy.
 *
 * Chạy: npm run admin:build   (vite build trước, rồi script này)
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(root, 'admin', 'dist');

// --out <dir>: xem giải thích trong build-web-site.mjs (Freebuff chỉ deploy được
// file nằm trong thư mục workspace của nó, không phải thư mục repo này).
const outFlagIndex = process.argv.indexOf('--out');
const outRoot =
  outFlagIndex !== -1 && process.argv[outFlagIndex + 1]
    ? resolve(root, process.argv[outFlagIndex + 1])
    : join(root, 'admin', 'site');
const assetsDir = join(outRoot, 'assets');

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}
const ok = (message) => console.log(`✓ ${message}`);

if (!existsSync(join(distDir, 'index.html'))) {
  fail(`Chưa có ${relative(root, distDir)}/index.html. Chạy: npm --prefix admin run build`);
}

rmSync(outRoot, { recursive: true, force: true });
mkdirSync(assetsDir, { recursive: true });

function copyTree(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    const source = join(from, entry);
    const target = join(to, entry);
    if (statSync(source).isDirectory()) copyTree(source, target);
    else copyFileSync(source, target);
  }
}
copyTree(distDir, assetsDir);

// Kiểm tra cấu hình đã được nhúng vào bundle chưa (khoá anon là công khai).
const assetsDirJs = join(assetsDir, 'assets');
const bundles = existsSync(assetsDirJs) ? readdirSync(assetsDirJs).filter((name) => name.endsWith('.js')) : [];
const joined = bundles.map((name) => readFileSync(join(assetsDirJs, name), 'utf8')).join('\n');
if (!joined.includes('supabase.co')) {
  fail(
    'Bundle không chứa URL Supabase → bản build thiếu cấu hình. Copy admin/.env.example thành admin/.env, điền VITE_SUPABASE_URL và VITE_SUPABASE_ANON_KEY rồi build lại.',
  );
}
// Chỉ tìm khoá THẬT (đủ dài), không tìm chuỗi 'sb_secret_' trần — chính mã
// nguồn kiểm tra tiền tố đó nên nó luôn xuất hiện trong bundle.
if (/sb_secret_[A-Za-z0-9_-]{20,}/.test(joined)) {
  fail('Bundle chứa khoá secret (sb_secret_…). Panel chỉ được dùng publishable/anon key.');
}
ok('Bundle có cấu hình Supabase, không chứa khoá secret');

// Worker tĩnh: không nghiệp vụ, không bí mật; chặn cache index.html.
writeFileSync(
  join(outRoot, 'worker.js'),
  `// Worker tĩnh cho admin panel VocabMaster. Không có logic nghiệp vụ, không có bí mật.
export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('X-Frame-Options', 'SAMEORIGIN');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    // Trang quản trị luôn phải là bản mới nhất sau mỗi lần deploy.
    if (headers.get('Content-Type')?.includes('text/html') || new URL(request.url).pathname === '/index.html') {
      headers.set('Cache-Control', 'no-cache');
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};
`,
);

writeFileSync(
  join(outRoot, 'manifest.json'),
  `${JSON.stringify(
    {
      entrypoint: 'index.js',
      compatibilityDate: '2026-10-01',
      modules: [{ name: 'index.js', type: 'esm', path: './worker.js' }],
      assetsDirectory: './assets',
      spa: true,
    },
    null,
    2,
  )}\n`,
);

ok(`Gói deploy: ${relative(root, outRoot) || outRoot} (${bundles.length} bundle JS)`);

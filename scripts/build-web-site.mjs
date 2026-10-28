#!/usr/bin/env node
/**
 * Đóng gói bản web tĩnh để deploy lên Freebuff Sites.
 *
 * Vì sao cần script này thay vì deploy thẳng thư mục export:
 *
 * 1. **COOP/COEP** — `expo-sqlite` trên web chạy wa-sqlite trong Web Worker và
 *    cần `SharedArrayBuffer`, thứ chỉ có khi trang `crossOriginIsolated`. Trình
 *    duyệt chỉ bật điều đó khi máy chủ gửi `Cross-Origin-Opener-Policy:
 *    same-origin` + `Cross-Origin-Embedder-Policy: require-corp`. Metro dev
 *    server đã gửi hai header này; máy chủ tĩnh thì không, nên phải tự gửi.
 *    Chọn `require-corp` (không phải `credentialless`) vì Safari trên iPhone
 *    không hiểu `credentialless` → trang sẽ mất cô lập và SQLite chết.
 *
 * 2. **PWA** — thêm manifest, icon và các thẻ meta để "Thêm vào màn hình chính"
 *    trên iPhone/Android mở ra như một ứng dụng, có safe-area cho tai thỏ.
 *
 * 3. **Icon** — dự án không có file PNG nào, nên icon được vẽ bằng mã ở đây
 *    (ghi PNG thuần bằng zlib của Node) thay vì thêm ảnh nhị phân vào repo.
 *
 * Chạy: npm run web:build   (export trước, rồi script này)
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs';import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(root, 'dist-web');

// --out <dir>: Freebuff chỉ deploy được file nằm trong thư mục workspace của nó,
// mà workspace đó không phải thư mục repo này. Nên cho phép trỏ gói deploy sang
// workspace khi cần đưa lên mạng, mặc định vẫn để trong repo.
const outFlagIndex = process.argv.indexOf('--out');
const outRoot =
  outFlagIndex !== -1 && process.argv[outFlagIndex + 1]
    ? resolve(root, process.argv[outFlagIndex + 1])
    : join(root, 'web', 'site');
const assetsDir = join(outRoot, 'assets');

const APP_NAME = 'VocabMaster';
const APP_DESCRIPTION =
  'Học từ vựng tiếng Anh: flashcard, ôn tập theo lịch, album nhắc từ, mini-game và đồng bộ nhiều thiết bị.';
const THEME_LIGHT = '#4C4EF5';
const THEME_DARK = '#0A0F1E';

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function ok(message) {
  console.log(`✓ ${message}`);
}

// ---------------------------------------------------------------------------
// PNG: ghi ảnh trực tiếp từ bộ đệm pixel (không cần thư viện ngoài)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function insideRoundedRect(x, y, left, top, width, height, radius) {
  if (x < left || y < top || x >= left + width || y >= top + height) return false;
  const r = Math.min(radius, width / 2, height / 2);
  if (r <= 0) return true;
  // Điểm gần nhất nằm trong "lõi chữ nhật" của hình bo tròn; nếu nằm trong bán
  // kính thì thuộc hình. Cạnh trơn nhờ lấy mẫu siêu cao ở trên, không cần nới.
  const cx = Math.min(Math.max(x, left + r), left + width - r);
  const cy = Math.min(Math.max(y, top + r), top + height - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/**
 * Vẽ icon: nền chuyển sắc tím–xanh, một thẻ trắng, ba vạch chữ bên trong.
 * `bleed: true` → nền tràn viền (cho apple-touch-icon và maskable: iOS/Android
 * tự bo góc, nếu ta bo sẵn thì sẽ thấy viền lạ).
 */
function drawIcon({ size, bleed, contentScale }) {
  const SS = 3; // lấy mẫu siêu cao để cạnh trơn, không răng cưa
  const W = size * SS;
  const pixels = Buffer.alloc(W * W * 4);
  const start = hexToRgb(THEME_LIGHT);
  const end = hexToRgb('#7B5CFA');
  const white = [255, 255, 255];
  const bar = hexToRgb('#3F41DC');
  const barAccent = hexToRgb('#0FA97F');

  const radius = bleed ? 0 : W * 0.22;

  const put = (x, y, rgb, alpha) => {
    const i = (y * W + x) * 4;
    pixels[i] = rgb[0];
    pixels[i + 1] = rgb[1];
    pixels[i + 2] = rgb[2];
    pixels[i + 3] = alpha;
  };

  // 1. Nền
  for (let y = 0; y < W; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (!insideRoundedRect(x, y, 0, 0, W, W, radius)) continue;
      put(x, y, mix(start, end, y / (W - 1)), 255);
    }
  }

  // 2. Thẻ trắng
  const cardSize = W * 0.58 * contentScale;
  const cardX = (W - cardSize) / 2;
  const cardY = (W - cardSize) / 2;
  const cardRadius = cardSize * 0.2;
  for (let y = 0; y < W; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (!insideRoundedRect(x, y, cardX, cardY, cardSize, cardSize, cardRadius)) continue;
      put(x, y, white, 255);
    }
  }

  // 3. Ba vạch chữ
  const inset = cardSize * 0.17;
  const barHeight = cardSize * 0.115;
  const rows = [
    { offset: 0.18, width: 0.66, color: bar },
    { offset: 0.435, width: 0.44, color: barAccent },
    { offset: 0.69, width: 0.56, color: bar },
  ];
  for (const row of rows) {
    const left = cardX + inset;
    const top = cardY + cardSize * row.offset;
    const width = cardSize * row.width;
    for (let y = 0; y < W; y += 1) {
      for (let x = 0; x < W; x += 1) {
        if (!insideRoundedRect(x, y, left, top, width, barHeight, barHeight / 2)) continue;
        put(x, y, row.color, 255);
      }
    }
  }

  // 4. Thu nhỏ về kích thước thật (trung bình SS×SS điểm ảnh)
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const i = ((y * SS + sy) * W + (x * SS + sx)) * 4;
          r += pixels[i];
          g += pixels[i + 1];
          b += pixels[i + 2];
          a += pixels[i + 3];
        }
      }
      const total = SS * SS;
      const o = (y * size + x) * 4;
      out[o] = Math.round(r / total);
      out[o + 1] = Math.round(g / total);
      out[o + 2] = Math.round(b / total);
      out[o + 3] = Math.round(a / total);
    }
  }

  return encodePng(size, size, out);
}

// ---------------------------------------------------------------------------
// index.html
// ---------------------------------------------------------------------------

function patchHtml(html) {
  let result = html;

  result = result.replace('<html lang="en">', '<html lang="vi">');
  result = result.replace(
    /<meta name="viewport"[^>]*>/,
    '<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover" />',
  );

  const head = [
    `<meta name="description" content="${APP_DESCRIPTION}" />`,
    '<meta name="color-scheme" content="light dark" />',
    `<meta name="theme-color" media="(prefers-color-scheme: light)" content="${THEME_LIGHT}" />`,
    `<meta name="theme-color" media="(prefers-color-scheme: dark)" content="${THEME_DARK}" />`,
    // Cho phép "Thêm vào màn hình chính" mở ra toàn màn hình, không có thanh địa chỉ.
    '<meta name="mobile-web-app-capable" content="yes" />',
    '<meta name="apple-mobile-web-app-capable" content="yes" />',
    '<meta name="apple-mobile-web-app-status-bar-style" content="default" />',
    `<meta name="apple-mobile-web-app-title" content="${APP_NAME}" />`,
    '<link rel="manifest" href="/manifest.webmanifest" />',
    '<link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png" />',
    '<link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon-180.png" />',
  ].join('\n    ');

  result = result.replace('</title>', `</title>\n    ${head}`);
  result = result.replace(
    /<noscript>\s*You need to enable JavaScript to run this app\.\s*<\/noscript>/,
    '<noscript>VocabMaster cần JavaScript. Hãy bật JavaScript rồi tải lại trang.</noscript>',
  );

  return result;
}

// ---------------------------------------------------------------------------
// Worker: thêm header cô lập + quy tắc cache
// ---------------------------------------------------------------------------

function workerSource() {
  return `// Worker tĩnh cho bản web VocabMaster. Không có bí mật, không có nghiệp vụ.
//
// Nhiệm vụ duy nhất: thêm hai header cô lập nguồn gốc (COOP/COEP) mà
// expo-sqlite cần để có SharedArrayBuffer, rồi trả file tĩnh. Dùng
// 'require-corp' chứ không phải 'credentialless': Safari trên iPhone không
// hiểu 'credentialless', gặp giá trị lạ thì coi như 'unsafe-none' → mất cô lập
// → SQLite WASM không chạy.
const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// Không dùng biểu thức chính quy ở đây: trong chuỗi mẫu sinh mã, việc thoát
// dấu gạch chéo rất dễ tạo ra regex hỏng, và Cloudflare trả lỗi 10021 (không
// nạp được script) chứ không nói rõ là lỗi cú pháp. So sánh chuỗi thì không sai được.
  const isImmutable = (pathname) => pathname.startsWith('/assets/') || pathname.startsWith('/_expo/');

const worker = {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);

    for (const [key, value] of Object.entries(ISOLATION_HEADERS)) headers.set(key, value);
    headers.set('X-Content-Type-Options', 'nosniff');
    // Không cho trang học tập bị nhúng trong iframe của nơi khác.
    headers.set('X-Frame-Options', 'SAMEORIGIN');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

    const url = new URL(request.url);
    if (isImmutable(url.pathname)) {
      // Tên file đã kèm hash nội dung nên giữ được lâu dài.
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (headers.get('Content-Type')?.includes('text/html') || url.pathname === '/index.html') {
      // index.html đổi mỗi lần deploy: không được để trình duyệt giữ bản cũ,
      // nếu không người dùng sẽ mãi chạy bundle cũ sau khi cập nhật.
      headers.set('Cache-Control', 'no-cache');
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};

export default worker;
`;
}

// ---------------------------------------------------------------------------

if (!existsSync(sourceDir)) {
  fail(`Chưa có ${relative(root, sourceDir)}. Chạy: npx expo export --platform web --output-dir dist-web`);
}

const htmlEntry = join(sourceDir, 'index.html');
if (!existsSync(htmlEntry)) fail('Bản export không có index.html — export có vẻ chưa xong.');

rmSync(outRoot, { recursive: true, force: true });
mkdirSync(assetsDir, { recursive: true });

// 1. Copy toàn bộ file đã export
function copyTree(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    const source = join(from, entry);
    const target = join(to, entry);
    if (statSync(source).isDirectory()) copyTree(source, target);
    else copyFileSync(source, target);
  }
}
copyTree(sourceDir, assetsDir);

// 1b. Vệ sinh đường dẫn lộ `node_modules`
//
// Metro giữ nguyên đường dẫn gốc cho asset của thư viện, nên file WASM của
// expo-sqlite được xuất ra `assets/node_modules/expo-sqlite/...`. Máy chủ tĩnh
// từ chối gói deploy chứa `node_modules` (coi là "dependencies"), và đúng là
// không nên để lộ cấu trúc thư mục nội bộ của dự án ra web. Đổi sang `vendor/`
// rồi cập nhật mọi tham chiếu trong JS/JSON/HTML.
function collectFiles(dir, list = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) collectFiles(path, list);
    else list.push(path);
  }
  return list;
}

const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.json', '.css', '.html', '.webmanifest', '.txt', '.xml']);

let relocated = 0;
for (const file of collectFiles(assetsDir)) {
  const relativePath = relative(assetsDir, file).split('\\').join('/');
  if (!relativePath.includes('node_modules/')) continue;
  const target = join(assetsDir, relativePath.replace('node_modules/', 'wasm/'));
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(file, target);
  rmSync(file);
  relocated += 1;
}

let rewritten = 0;
if (relocated > 0) {
  for (const file of collectFiles(assetsDir)) {
    const extension = file.slice(file.lastIndexOf('.'));
    if (!TEXT_EXTENSIONS.has(extension)) continue;
    const before = readFileSync(file, 'utf8');
    if (!before.includes('node_modules')) continue;
    writeFileSync(file, before.split('node_modules/').join('wasm/'));
    rewritten += 1;
  }
}

// Di chuyển file xong sẽ còn lại các thư mục rỗng mang tên cũ. Máy chủ tĩnh
// duyệt cả cây thư mục, nên một thư mục `node_modules` rỗng vẫn đủ để gói
// deploy bị từ chối ("no … dependencies"). Dọn sạch thư mục rỗng.
function pruneEmptyDirs(dir) {
  let removed = 0;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (!statSync(path).isDirectory()) continue;
    removed += pruneEmptyDirs(path);
    if (readdirSync(path).length === 0) {
      rmSync(path, { recursive: true });
      removed += 1;
    }
  }
  return removed;
}
const prunedDirs = pruneEmptyDirs(assetsDir);

// Không được còn dấu vết nào: nếu còn, gói deploy sẽ bị từ chối hoặc app sẽ
// trỏ vào file không tồn tại. Kiểm tra cả thư mục, không chỉ file.
const leftovers = [];
(function scan(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const relativePath = relative(assetsDir, path);
    if (relativePath.split(/[\\/]/).includes('node_modules')) leftovers.push(relativePath);
    if (statSync(path).isDirectory()) scan(path);
  }
})(assetsDir);
if (leftovers.length > 0) fail(`Còn đường dẫn node_modules trong gói: ${leftovers.join(', ')}`);
if (relocated > 0) {
  ok(
    `Đổi ${relocated} asset khỏi node_modules/ (cập nhật ${rewritten} file tham chiếu, dọn ${prunedDirs} thư mục rỗng)`,
  );
}

// 2. index.html: chỉnh cho đúng tiếng Việt + PWA
writeFileSync(join(assetsDir, 'index.html'), patchHtml(readFileSync(htmlEntry, 'utf8')));

// 3. Icon + manifest
const iconDir = join(assetsDir, 'icons');
mkdirSync(iconDir, { recursive: true });
const icons = [
  { file: 'icon-192.png', size: 192, bleed: false, contentScale: 1 },
  { file: 'icon-512.png', size: 512, bleed: false, contentScale: 1 },
  // Maskable: nền tràn viền, nội dung thu nhỏ để không bị mặt nạ tròn cắt mất.
  { file: 'icon-maskable-512.png', size: 512, bleed: true, contentScale: 0.72 },
  // iOS tự bo góc nên icon phải là hình vuông đặc.
  { file: 'apple-touch-icon-180.png', size: 180, bleed: true, contentScale: 0.92 },
];
for (const icon of icons) {
  writeFileSync(join(iconDir, icon.file), drawIcon(icon));
}

const manifest = {
  name: APP_NAME,
  short_name: APP_NAME,
  description: APP_DESCRIPTION,
  lang: 'vi',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#F5F6FB',
  theme_color: THEME_LIGHT,
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};
writeFileSync(join(assetsDir, 'manifest.webmanifest'), `${JSON.stringify(manifest, null, 2)}\n`);

// 4. Worker + manifest deploy
const workerPath = join(outRoot, 'worker.js');
writeFileSync(workerPath, workerSource());

// Worker sai cú pháp chỉ lộ ra khi Cloudflare từ chối deploy (mã 10021,
// "worker_upload"). Kiểm ngay tại máy cho biết trước.
const syntaxCheck = spawnSync(process.execPath, ['--check', workerPath], { encoding: 'utf8' });
if (syntaxCheck.status !== 0) {
  fail(`worker.js sai cú pháp:\n${syntaxCheck.stderr.trim()}`);
}
ok('worker.js hợp lệ về cú pháp');
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

// 5. Báo cáo gọn để người đọc biết gói deploy chứa gì
let totalBytes = 0;
let fileCount = 0;
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path);
    else {
      totalBytes += statSync(path).size;
      fileCount += 1;
    }
  }
})(assetsDir);

const bundleHash = createHash('sha256');
bundleHash.update(readFileSync(join(assetsDir, 'index.html')));

ok(`Gói deploy: ${relative(root, outRoot) || outRoot} (${fileCount} file, ${(totalBytes / 1024 / 1024).toFixed(2)} MiB)`);
ok(`index.html: ${bundleHash.digest('hex').slice(0, 12)}`);
ok('Header COOP/COEP: same-origin + require-corp (bản iOS không bị ảnh hưởng)');

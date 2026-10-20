#!/usr/bin/env node
/**
 * Checkpoint validator.
 *
 * Checks that:
 *  - CHECKPOINT.json is valid JSON with the required keys and status vocabulary
 *  - the mandatory handoff files exist
 *  - every file listed in important_files exists on disk
 *  - obvious secrets (Google API keys, private keys, tokens) are not committed
 *
 * Read-only. Run: node scripts/validate-checkpoint.mjs
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const errors = [];
const warnings = [];
const checks = [];

function check(name, fn) {
  try {
    const detail = fn();
    checks.push({ name, ok: true, detail });
  } catch (error) {
    checks.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
    errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const requiredFiles = [
  'CHECKPOINT.md',
  'CHECKPOINT.json',
  'CHANGELOG.md',
  'NEXT_SESSION.md',
  'README.md',
  'app.json',
  'package.json',
  'App.tsx',
  'docs/FEASIBILITY.md',
];

check('Các file bàn giao bắt buộc', () => {
  const missing = requiredFiles.filter((file) => !existsSync(join(root, file)));
  if (missing.length > 0) throw new Error(`thiếu: ${missing.join(', ')}`);
  return `${requiredFiles.length} file`;
});

let checkpoint = null;
check('CHECKPOINT.json là JSON hợp lệ', () => {
  const raw = readFileSync(join(root, 'CHECKPOINT.json'), 'utf8');
  checkpoint = JSON.parse(raw);
  return 'OK';
});

const requiredKeys = [
  'project_name',
  'project_path',
  'checkpoint_version',
  'last_updated',
  'current_phase',
  'tech_stack',
  'completed_features',
  'in_progress_features',
  'pending_features',
  'known_bugs',
  'resolved_bugs',
  'verified_capabilities',
  'unverified_capabilities',
  'test_results',
  'important_files',
  'next_steps',
  'blocked_by',
  'environment_requirements',
];

check('Các trường bắt buộc trong checkpoint', () => {
  if (!checkpoint) throw new Error('không đọc được CHECKPOINT.json');
  const missing = requiredKeys.filter((key) => !(key in checkpoint));
  if (missing.length > 0) throw new Error(`thiếu trường: ${missing.join(', ')}`);
  return `${requiredKeys.length} trường`;
});

check('important_files tồn tại trên đĩa', () => {
  if (!checkpoint) throw new Error('không đọc được CHECKPOINT.json');
  const files = Array.isArray(checkpoint.important_files) ? checkpoint.important_files : [];
  const paths = files
    .map((item) => (typeof item === 'string' ? item : item?.path))
    .filter((value) => typeof value === 'string' && value.length > 0);
  const missing = paths.filter((path) => !existsSync(join(root, path)));
  if (missing.length > 0) throw new Error(`không thấy: ${missing.join(', ')}`);
  return `${paths.length} file`;
});

check('Trạng thái tính năng dùng đúng từ vựng', () => {
  if (!checkpoint) throw new Error('không đọc được CHECKPOINT.json');
  const allowed = new Set(['planned', 'implemented', 'tested', 'verified_on_device', 'blocked']);
  const buckets = ['completed_features', 'in_progress_features', 'pending_features'];
  const bad = [];
  for (const bucket of buckets) {
    const items = Array.isArray(checkpoint[bucket]) ? checkpoint[bucket] : [];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      if (!allowed.has(item.status)) bad.push(`${bucket}: ${item.name ?? '?'} → ${item.status}`);
    }
  }
  if (bad.length > 0) throw new Error(bad.join('; '));
  return 'OK';
});

const secretPatterns = [
  { name: 'Google API key', pattern: /AIza[0-9A-Za-z_-]{30,}/ },
  { name: 'Private key block', pattern: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'GitHub token', pattern: /gh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: 'Expo token', pattern: /expo[_-][A-Za-z0-9]{20,}/i },
  { name: 'Assigned secret', pattern: /(GEMINI_API_KEY|EXPO_TOKEN|APPLE_APP_PASSWORD)\s*=\s*['"]?[^\s'"]{8,}/ },
];

check('Không có secret rõ ràng trong file bàn giao', () => {
  const files = ['CHECKPOINT.md', 'CHECKPOINT.json', 'CHANGELOG.md', 'NEXT_SESSION.md', 'README.md', '.env.example'];
  const hits = [];
  for (const file of files) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    const content = readFileSync(path, 'utf8');
    for (const { name, pattern } of secretPatterns) {
      if (pattern.test(content)) hits.push(`${file}: ${name}`);
    }
  }
  if (hits.length > 0) throw new Error(hits.join('; '));
  return 'sạch';
});

check('.env bị gitignore', () => {
  const ignorePath = join(root, '.gitignore');
  if (!existsSync(ignorePath)) throw new Error('thiếu .gitignore');
  const ignore = readFileSync(ignorePath, 'utf8');
  if (!/^\.env$/m.test(ignore) && !/^\.env\*$/m.test(ignore)) {
    warnings.push('.gitignore chưa có mục .env');
  }
  return 'OK';
});

const filesize = (file) => {
  try {
    return statSync(join(root, file)).size;
  } catch {
    return 0;
  }
};

console.log('Kiểm tra checkpoint VocabMaster');
console.log(`Thư mục: ${relative(process.cwd(), root) || '.'}\n`);
for (const item of checks) {
  console.log(`${item.ok ? '✔' : '✖'} ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
}

for (const file of ['CHECKPOINT.md', 'CHANGELOG.md', 'NEXT_SESSION.md']) {
  if (filesize(file) < 300) warnings.push(`${file} có vẻ quá ngắn (${filesize(file)} bytes)`);
}

if (warnings.length > 0) {
  console.log('\nCảnh báo:');
  for (const warning of warnings) console.log(`  ⚠ ${warning}`);
}

if (errors.length > 0) {
  console.log(`\n✖ ${errors.length} lỗi.`);
  process.exit(1);
}

console.log('\n✔ Checkpoint hợp lệ.');

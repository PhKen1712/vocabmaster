#!/usr/bin/env node
/**
 * VocabMaster dependency bootstrap.
 *
 * Why this exists: Expo native modules must be installed with `expo install`
 * so their versions match the installed Expo SDK. `npm install` alone is enough
 * for the JavaScript libraries, so this script does both, in the right order.
 *
 * It never deletes project files and never touches Git.
 * Run from the project root:  node scripts/setup.mjs
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const isWindows = process.platform === 'win32';

function run(command) {
  console.log(`\n$ ${command}`);
  const result = spawnSync(command, {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
  if (result.error) {
    console.error(`Không chạy được lệnh: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`\nLệnh thất bại (exit ${result.status}): ${command}`);
    process.exit(result.status ?? 1);
  }
}

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

console.log('VocabMaster setup');
console.log(`Thư mục: ${root}`);
console.log(`Nền tảng: ${process.platform} ${process.arch}`);

if (!existsSync(join(root, 'package.json'))) {
  fail('Không thấy package.json. Hãy chạy script này trong thư mục dự án VocabMaster.');
}

const [major = '0', minor = '0'] = process.versions.node.split('.');
const nodeMajor = Number(major);
const nodeMinor = Number(minor);
if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 13)) {
  console.warn(
    `\n⚠ Node ${process.versions.node} đang được dùng. Expo SDK 58 cần Node 22.13+ (hoặc 24/26 LTS).`,
  );
  console.warn('  Tải bản LTS mới tại https://nodejs.org rồi chạy lại script này.\n');
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter(
  (name) => name === 'expo' || name.startsWith('expo-') || name.startsWith('@expo/'),
);

console.log(`\nBước 1/3: cài dependency JavaScript (${deps.length} gói Expo)`);
run('npm install');

console.log('\nBước 2/3: đồng bộ phiên bản native module với Expo SDK');
run(`npx expo install ${deps.join(' ')} expo-dev-client`);

console.log('\nBước 3/3: kiểm tra và sửa lệch phiên bản còn lại');
run('npx expo install --fix');

if (!isWindows) {
  console.log('\nGhi chú: iOS build cần macOS hoặc EAS Build. Windows không build iOS cục bộ được.');
}

console.log('\n✔ Xong. Bước tiếp theo:');
console.log('  1) npm run typecheck');
console.log('  2) npm test');
console.log('  3) npx expo prebuild --platform ios   (hoặc build trên EAS như docs/BUILD_AND_INSTALL.md)');

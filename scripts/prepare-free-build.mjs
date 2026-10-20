#!/usr/bin/env node
/**
 * Chuẩn bị app.json cho bản build sideload bằng Apple ID MIỄN PHÍ.
 *
 * Apple ID miễn phí (Personal Team) không được cấp App Groups, nên widget
 * extension không thể ký/cài và không thể đọc dữ liệu học. Bản build miễn phí
 * vì vậy bỏ plugin `expo-widgets` khỏi app.json; toàn bộ code widget vẫn nằm
 * trong repo và tự bật lại khi build bằng tài khoản trả phí.
 *
 *   node scripts/prepare-free-build.mjs            # bỏ widget, giữ backup
 *   node scripts/prepare-free-build.mjs --restore  # khôi phục app.json gốc
 *   node scripts/prepare-free-build.mjs --check    # chỉ in ra, không ghi
 *
 * Không xoá bất kỳ file widget nào — chỉ sửa danh sách plugin trong app.json.
 */
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appJsonPath = resolve(projectRoot, 'app.json');
const backupPath = resolve(projectRoot, 'app.json.free-build.bak');

const args = new Set(process.argv.slice(2));
const checkOnly = args.has('--check');
const restore = args.has('--restore');

const WIDGET_PLUGIN = 'expo-widgets';

function pluginName(entry) {
  if (typeof entry === 'string') return entry;
  if (Array.isArray(entry) && typeof entry[0] === 'string') return entry[0];
  return null;
}

if (restore) {
  if (!existsSync(backupPath)) {
    console.error('Không có app.json.free-build.bak để khôi phục.');
    process.exit(1);
  }
  writeFileSync(appJsonPath, readFileSync(backupPath, 'utf8'), 'utf8');
  rmSync(backupPath);
  console.log('Đã khôi phục app.json gốc (có widget).');
  process.exit(0);
}

const raw = readFileSync(appJsonPath, 'utf8');
const config = JSON.parse(raw);
const expo = config.expo ?? config;
const plugins = Array.isArray(expo.plugins) ? expo.plugins : [];
const kept = plugins.filter((entry) => pluginName(entry) !== WIDGET_PLUGIN);
const removed = plugins.length - kept.length;

if (removed === 0) {
  console.log('app.json không có plugin widget nào — không cần sửa.');
  process.exit(0);
}

console.log(`Bỏ ${removed} plugin widget khỏi app.json để build bằng Apple ID miễn phí.`);
if (checkOnly) {
  console.log('(--check) Không ghi file.');
  process.exit(0);
}

if (!existsSync(backupPath)) {
  writeFileSync(backupPath, raw, 'utf8');
  console.log(`Đã sao lưu app.json gốc → ${backupPath}`);
}

expo.plugins = kept;
writeFileSync(appJsonPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
console.log('app.json đã được cập nhật (không còn expo-widgets).');

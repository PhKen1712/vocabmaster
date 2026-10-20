#!/usr/bin/env node
/**
 * Chạy typecheck + unit test + kiểm tra checkpoint, ghi toàn bộ output ra
 * `tools/verify-report.txt` để phiên sau đọc lại được (không cần Bash).
 *
 * Chạy: node scripts/verify.mjs
 * Exit code: 0 nếu mọi bước pass, 1 nếu có bước fail.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = resolve(projectRoot, 'tools/verify-report.txt');

const steps = [
  // Cần chạy lại sau khi thêm dependency (expo-speech-recognition).
  { name: 'install', args: ['install', '--no-audit', '--no-fund'] },
  { name: 'typecheck', args: ['run', 'typecheck'] },
  { name: 'test', args: ['test', '--', '--ci'] },
  { name: 'checkpoint:validate', args: ['run', 'checkpoint:validate'] },
];

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const lines = [];
let failed = 0;

function flush(summary) {
  mkdirSync(dirname(reportPath), { recursive: true });
  const header = [`summary    : ${summary}`, ''];
  writeFileSync(reportPath, [...lines.slice(0, 5), ...header, ...lines.slice(5)].join('\n') + '\n', 'utf8');
}

lines.push(`VocabMaster verification`);
lines.push(`node       : ${process.version}`);
lines.push(`platform   : ${process.platform} ${process.arch}`);
lines.push(`started at : ${new Date().toISOString()}`);
lines.push('');

for (const step of steps) {
  const started = Date.now();
  process.stdout.write(`\n=== ${step.name} ===\n`);

  const result = spawnSync(npmCmd, step.args, {
    cwd: projectRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
    maxBuffer: 32 * 1024 * 1024,
    // npm install có thể lâu hơn các bước còn lại.
    timeout: step.name === 'install' ? 10 * 60 * 1000 : 5 * 60 * 1000,
  });

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const status = result.error ? `error: ${result.error.message}` : `exit ${result.status}`;

  lines.push(`=== ${step.name} ===`);
  lines.push(`command : npm ${step.args.join(' ')}`);
  lines.push(`result  : ${status}`);
  lines.push(`time    : ${seconds}s`);
  if (result.signal) lines.push(`signal  : ${result.signal}`);
  lines.push('--- stdout ---');
  lines.push((result.stdout || '').trimEnd() || '(empty)');
  lines.push('--- stderr ---');
  lines.push((result.stderr || '').trimEnd() || '(empty)');
  lines.push('');

  process.stdout.write((result.stdout || '') + (result.stderr || ''));
  if (result.status !== 0) {
    failed += 1;
    process.stdout.write(`\n[FAIL] ${step.name} (${status})\n`);
  } else {
    process.stdout.write(`\n[PASS] ${step.name}\n`);
  }

  // Ghi ngay sau mỗi bước: nếu bước sau treo hoặc bị kill, report vẫn còn kết quả
  // của các bước trước thay vì mất trắng.
  flush(`${failed} step(s) FAILED so far; still running`);
}

lines.push(`finished at: ${new Date().toISOString()}`);
lines.push(`summary    : ${failed === 0 ? 'ALL PASS' : `${failed} step(s) FAILED`}`);

mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, lines.join('\n') + '\n', 'utf8');

process.stdout.write(`\nReport written to ${reportPath}\n`);
process.stdout.write(`Summary: ${failed === 0 ? 'ALL PASS' : `${failed} step(s) FAILED`}\n`);

process.exit(failed === 0 ? 0 : 1);

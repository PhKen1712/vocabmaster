#!/usr/bin/env node
/**
 * VocabMaster — tạo / khôi phục tài khoản quản trị.
 *
 * Vì sao cần script này thay vì làm trên giao diện:
 *   - Tạo tài khoản bằng Admin API cần `service_role` key, và khoá đó TUYỆT ĐỐI
 *     không được nằm trong trình duyệt. Nên việc này phải chạy ở máy bạn.
 *   - Đặt lại mật khẩu admin khi quên: cùng lý do.
 *
 * An toàn:
 *   - Mật khẩu KHÔNG bao giờ được in ra, không ghi vào file, không vào git.
 *   - Nhập mật khẩu bằng bàn phím (ẩn ký tự), hoặc đọc từ biến môi trường
 *     ADMIN_PASSWORD khi chạy không tương tác.
 *   - script CHỈ gọi Admin API với khoá trong .env.cloud.local (đã gitignore),
 *     và tự kiểm tra lại bằng một lần đăng nhập thật ở cuối.
 *
 * Cách dùng (chạy trong thư mục gốc dự án):
 *
 *   npm run admin:create                      # tạo admin mới (hỏi email/mật khẩu)
 *   npm run admin:create -- --email a@b.com   # hỏi mật khẩu
 *   npm run admin:reset -- --email a@b.com    # đặt lại mật khẩu cho user đã có
 *   npm run admin:promote -- --email a@b.com  # cấp quyền admin cho user đã có
 *   npm run admin:promote -- --email a@b.com --demote   # thu quyền admin
 *
 * Tuỳ chọn thêm:
 *   --password-file <đường dẫn>   đọc mật khẩu từ file (xoá file sau khi dùng)
 *   --username <tên hiển thị>     mặc định lấy phần trước @ của email
 *   --no-verify                   bỏ qua bước đăng nhập thử
 */

import { createInterface } from 'node:readline';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// ---------------------------------------------------------------------------
// Đọc cấu hình
// ---------------------------------------------------------------------------

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const value = match[2].trim().replace(/^["']|["']$/g, '');
    out[match[1]] = value;
  }
  return out;
}

const publicEnv = readEnvFile(join(root, '.env'));
const secretEnv = readEnvFile(join(root, '.env.cloud.local'));

const url = (process.env.SUPABASE_URL ?? publicEnv.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '');
const anonKey = process.env.SUPABASE_ANON_KEY ?? publicEnv.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? secretEnv.SUPABASE_SERVICE_ROLE_KEY ?? '';

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

if (!url || !/^https:\/\/.+\.supabase\.co$/.test(url)) {
  fail('Thiếu EXPO_PUBLIC_SUPABASE_URL hợp lệ trong .env (dạng https://<ref>.supabase.co).');
}
if (!serviceKey) {
  fail(
    'Thiếu SUPABASE_SERVICE_ROLE_KEY trong .env.cloud.local.\n' +
      '  Lấy ở Supabase → Project Settings → API → service_role key.\n' +
      '  Đặt vào .env.cloud.local (file này đã bị gitignore, đừng commit).',
  );
}
if (!anonKey) {
  fail(
    'Thiếu EXPO_PUBLIC_SUPABASE_ANON_KEY trong .env.\n' +
      '  Bước kiểm tra đăng nhập cần khoá công khai này. Nếu vẫn muốn bỏ qua, thêm --no-verify.',
  );
}

// ---------------------------------------------------------------------------
// Tham số dòng lệnh
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const mode = args.includes('--promote')
  ? 'promote'
  : args.includes('--reset-password')
    ? 'reset'
    : 'create';

function argValue(name) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : null;
}

const flags = {
  email: argValue('--email'),
  username: argValue('--username'),
  passwordFile: argValue('--password-file'),
  demote: args.includes('--demote'),
  verify: !args.includes('--no-verify'),
};

// ---------------------------------------------------------------------------
// Gọi API
// ---------------------------------------------------------------------------

async function api(path, { method = 'GET', body, key = serviceKey, bearer = serviceKey } = {}) {
  const response = await fetch(`${url}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { ok: response.ok, status: response.status, data };
}

async function findUserByEmail(email) {
  const target = email.toLowerCase();
  for (let page = 1; page <= 20; page += 1) {
    const { ok, data } = await api(`/auth/v1/admin/users?page=${page}&per_page=200`);
    if (!ok) fail(`Không đọc được danh sách người dùng (HTTP ${ok ? 200 : 'lỗi'}).`);
    const users = data?.users ?? [];
    const found = users.find((user) => (user.email ?? '').toLowerCase() === target);
    if (found) return found;
    if (users.length < 200) return null;
  }
  return null;
}

async function setProfileRole(userId, { role, status, username }) {
  const patch = {};
  if (role) patch.role = role;
  if (status) patch.status = status;
  if (username) patch.username = username;

  const response = await fetch(`${url}/rest/v1/profiles?user_id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(patch),
  });
  const text = await response.text();
  if (!response.ok) {
    fail(`Không cập nhật được hồ sơ (HTTP ${response.status}): ${text.slice(0, 200)}`);
  }
  const rows = text ? JSON.parse(text) : [];
  return rows[0] ?? null;
}

/**
 * Đăng nhập thật bằng email + mật khẩu, dùng đúng khoá công khai mà panel dùng.
 * Đây là bằng chứng cuối cùng: mật khẩu vừa đặt có dùng được hay không.
 */
async function verifyLogin(email, password) {
  const { ok, status, data } = await api('/auth/v1/token?grant_type=password', {
    method: 'POST',
    key: anonKey,
    bearer: anonKey,
    body: { email, password },
  });
  if (!ok) {
    return { ok: false, detail: data?.error_description ?? data?.msg ?? `HTTP ${status}` };
  }
  const accessToken = data?.access_token;
  const userId = data?.user?.id;
  if (!accessToken || !userId) return { ok: false, detail: 'Không nhận được phiên đăng nhập.' };

  // Kiểm tra luôn quyền: đọc hồ sơ của chính mình qua RLS như panel vẫn làm.
  const profile = await api(`/rest/v1/profiles?user_id=eq.${userId}&select=username,role,status`, {
    key: anonKey,
    bearer: accessToken,
  });

  // Không giữ phiên lại: huỷ ngay sau khi kiểm tra.
  await api('/auth/v1/logout', { method: 'POST', key: anonKey, bearer: accessToken });

  return {
    ok: true,
    userId,
    profile: Array.isArray(profile.data) ? profile.data[0] : null,
  };
}

// ---------------------------------------------------------------------------
// Nhập mật khẩu (ẩn ký tự)
// ---------------------------------------------------------------------------

function readHidden(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(
        new Error(
          'Không có bàn phím tương tác. Hãy truyền --password-file <đường dẫn> hoặc đặt biến ADMIN_PASSWORD.',
        ),
      );
      return;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const stdin = process.stdin;
    process.stdout.write(question);
    const wasRaw = stdin.isRaw;
    if (stdin.setRawMode) stdin.setRawMode(true);
    stdin.resume();

    let value = '';
    const finish = (result, error) => {
      stdin.removeListener('data', onData);
      if (stdin.setRawMode) stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      rl.close();
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(result);
    };
    const onData = (chunk) => {
      const text = chunk.toString('utf8');
      for (const char of text) {
        if (char === '\r' || char === '\n') return finish(value);
        if (char === '\u0003') return finish('', new Error('Đã huỷ.'));
        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };
    stdin.on('data', onData);
  });
}

async function askVisible(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function obtainPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  if (flags.passwordFile) {
    if (!existsSync(flags.passwordFile)) fail(`Không thấy file mật khẩu: ${flags.passwordFile}`);
    return readFileSync(flags.passwordFile, 'utf8').replace(/\r?\n$/, '');
  }
  const first = await readHidden('Mật khẩu (ít nhất 8 ký tự, không hiện ra màn hình): ');
  if (first.length < 8) fail('Mật khẩu cần ít nhất 8 ký tự.');
  const again = await readHidden('Nhập lại mật khẩu: ');
  if (first !== again) fail('Hai lần nhập không khớp.');
  return first;
}

// ---------------------------------------------------------------------------
// Các nhánh công việc
// ---------------------------------------------------------------------------

async function doCreate() {
  const email = flags.email ?? (await askVisible('Email quản trị: '));
  if (!email || !email.includes('@')) fail('Email không hợp lệ.');

  const existing = await findUserByEmail(email);
  if (existing) {
    fail(
      `Email ${email} đã tồn tại (id ${existing.id.slice(0, 8)}…).\n` +
        '  Muốn cấp quyền admin: npm run admin:promote -- --email ' +
        email +
        '\n  Muốn đặt lại mật khẩu: npm run admin:reset -- --email ' +
        email,
    );
  }

  const password = await obtainPassword();
  const username = flags.username ?? email.split('@')[0];

  const { ok, status, data } = await api('/auth/v1/admin/users', {
    method: 'POST',
    body: {
      email,
      password,
      email_confirm: true, // admin tạo tài khoản → khỏi vòng xác nhận email
      user_metadata: { username },
    },
  });
  if (!ok) fail(`Tạo tài khoản thất bại (HTTP ${status}): ${JSON.stringify(data).slice(0, 300)}`);

  const userId = data.id;
  console.log(`• Đã tạo tài khoản: ${email} (id ${userId.slice(0, 8)}…)`);

  const profile = await setProfileRole(userId, { role: 'admin', status: 'active', username });
  console.log(
    profile
      ? `• Hồ sơ: username=${profile.username} role=${profile.role} status=${profile.status}`
      : '• Hồ sơ do trigger tạo; đã cập nhật quyền admin.',
  );

  if (flags.verify) await runVerification(email, password, { expectAdmin: true });
  console.log('\n✔ Xong. Đăng nhập ở admin panel bằng email vừa tạo.');
}

async function doReset() {
  const email = flags.email ?? (await askVisible('Email cần đặt lại mật khẩu: '));
  const user = await findUserByEmail(email);
  if (!user) fail(`Không thấy tài khoản ${email}.`);

  const password = await obtainPassword();
  const { ok, status, data } = await api(`/auth/v1/admin/users/${user.id}`, {
    method: 'PUT',
    body: { password, email_confirm: true },
  });
  if (!ok) fail(`Đặt lại mật khẩu thất bại (HTTP ${status}): ${JSON.stringify(data).slice(0, 300)}`);

  console.log(`• Đã đặt lại mật khẩu cho ${email} (id ${user.id.slice(0, 8)}…)`);
  if (flags.verify) await runVerification(email, password, { expectAdmin: null });
  console.log('\n✔ Xong. Hãy đăng nhập và đổi mật khẩu nếu cần.');
}

async function doPromote() {
  const email = flags.email ?? (await askVisible('Email cần đổi quyền: '));
  const user = await findUserByEmail(email);
  if (!user) fail(`Không thấy tài khoản ${email}.`);

  const role = flags.demote ? 'user' : 'admin';
  const profile = await setProfileRole(user.id, { role, status: 'active' });
  if (!profile) fail('Không tìm thấy hồ sơ để cập nhật (profiles).');
  console.log(`• ${email}: role=${profile.role} status=${profile.status}`);

  if (flags.demote) {
    // Chốt an toàn: không để hệ thống hết admin.
    const { ok, data } = await api('/rest/v1/profiles?role=eq.admin&select=user_id', {});
    const adminCount = ok && Array.isArray(data) ? data.length : null;
    if (adminCount === 0) {
      console.warn('\n⚠ Không còn tài khoản admin nào. Cấp lại quyền trước khi cần quản trị.');
    } else if (adminCount !== null) {
      console.log(`• Còn ${adminCount} tài khoản admin trong hệ thống.`);
    }
  }
  console.log('\n✔ Xong.');
}

async function runVerification(email, password, { expectAdmin }) {
  const result = await verifyLogin(email, password);
  if (!result.ok) {
    console.error(`\n✖ Đăng nhập thử THẤT BẠI: ${result.detail}`);
    console.error('  Tài khoản đã tồn tại nhưng mật khẩu không dùng được — kiểm tra lại chính sách Auth.');
    process.exitCode = 1;
    return;
  }
  console.log(`• Đăng nhập thử: OK (id ${result.userId.slice(0, 8)}…)`);
  if (result.profile) {
    console.log(
      `• Đọc hồ sơ qua RLS: role=${result.profile.role} status=${result.profile.status}`,
    );
    if (expectAdmin === true && result.profile.role !== 'admin') {
      console.error('✖ Tài khoản này KHÔNG có quyền admin.');
      process.exitCode = 1;
    }
    if (result.profile.status !== 'active') {
      console.error('✖ Tài khoản đang bị khoá (status != active) → panel sẽ từ chối vào.');
      process.exitCode = 1;
    }
  } else {
    console.warn('! Không đọc được hồ sơ qua RLS — kiểm tra lại policy của bảng profiles.');
  }
}

const runners = { create: doCreate, reset: doReset, promote: doPromote };
await runners[mode]();

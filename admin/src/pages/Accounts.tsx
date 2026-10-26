import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { callAdminUsers, loadAccounts, type AccountRow } from '../lib/api';
import { dateTime, num, shortId } from '../lib/format';

const PAGE_SIZE = 25;

export default function Accounts({
  onPick,
  onOpen,
}: {
  onPick: (account: AccountRow) => void;
  onOpen: (account: AccountRow) => void;
}) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await loadAccounts(query, page, PAGE_SIZE));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tải được danh sách');
    } finally {
      setLoading(false);
    }
  }, [query, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const total = rows[0]?.total_count ?? 0;
  const lastPage = Math.max(Math.ceil(total / PAGE_SIZE) - 1, 0);

  return (
    <section>
      <div className="spread">
        <div>
          <h1>Tài khoản</h1>
          <p className="muted small">
            Chỉ admin tạo được tài khoản — không có đăng ký công khai. Mật khẩu do Supabase lưu dưới dạng hash.
          </p>
        </div>
        <button className="btn" onClick={() => void load()} disabled={loading}>
          {loading ? 'Đang tải…' : 'Làm mới'}
        </button>
      </div>

      <CreateForm
        onCreated={(username) => {
          setNotice(`Đã tạo tài khoản "${username}". Hãy gửi email + mật khẩu cho người dùng qua kênh riêng.`);
          setQuery('');
          setSearch('');
          setPage(0);
          void load();
        }}
      />

      {notice && <p className="ok" style={{ marginTop: 12 }}>{notice}</p>}
      {error && <p className="error" style={{ marginTop: 12 }}>{error}</p>}

      <div className="card" style={{ marginTop: 16 }}>
        <form
          className="row"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(0);
            setQuery(search);
          }}
        >
          <input
            style={{ flex: 1, minWidth: 200 }}
            placeholder="Tìm theo tên đăng nhập hoặc dán UUID…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button className="btn" type="submit">Tìm</button>
          {query && (
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                setSearch('');
                setQuery('');
                setPage(0);
              }}
            >
              Xoá lọc
            </button>
          )}
        </form>

        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th>Tên đăng nhập</th>
                <th>Vai trò</th>
                <th>Trạng thái</th>
                <th className="num">Từ</th>
                <th className="num">Đến hạn</th>
                <th className="num">Lượt ôn</th>
                <th className="num">Xu</th>
                <th>Lần ôn cuối</th>
                <th>Tạo lúc</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <AccountLine key={row.user_id} row={row} onPick={onPick} onOpen={onOpen} onChanged={load} />
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="muted" style={{ padding: 18 }}>
                    {query ? 'Không tìm thấy tài khoản nào khớp.' : 'Chưa có tài khoản nào. Tạo tài khoản đầu tiên ở trên.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="pager">
          <button className="btn" disabled={page === 0 || loading} onClick={() => setPage((p) => Math.max(p - 1, 0))}>
            ← Trước
          </button>
          <span className="small muted">
            Trang {page + 1}/{lastPage + 1} · {num(total)} tài khoản
          </span>
          <button className="btn" disabled={page >= lastPage || loading} onClick={() => setPage((p) => p + 1)}>
            Sau →
          </button>
        </div>
      </div>
    </section>
  );
}

function CreateForm({ onCreated }: { onCreated: (username: string) => void }) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      setError('Mật khẩu phải từ 8 ký tự và có cả chữ lẫn số.');
      return;
    }

    setBusy(true);
    try {
      await callAdminUsers({ action: 'create', username: username.trim(), email: email.trim(), password });
      setUsername('');
      setEmail('');
      setPassword('');
      onCreated(username.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tạo được tài khoản');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" style={{ marginTop: 16 }} onSubmit={submit}>
      <h2>Tạo tài khoản</h2>
      <p className="muted small">
        Cần Edge Function <span className="mono">admin-users</span> đã deploy — hàm này kiểm tra người gọi là admin
        rồi mới dùng quyền server để tạo user.
      </p>
      <div className="row" style={{ marginTop: 10 }}>
        <label className="field" style={{ flex: 1, minWidth: 160 }}>
          <span>Tên đăng nhập</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} required maxLength={60} />
        </label>
        <label className="field" style={{ flex: 1, minWidth: 200 }}>
          <span>Email (dùng để đăng nhập)</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field" style={{ flex: 1, minWidth: 180 }}>
          <span>Mật khẩu ban đầu</span>
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </label>
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Đang tạo…' : 'Tạo tài khoản'}
        </button>
      </div>
      <p className="muted small" style={{ marginTop: 8 }}>
        Ô mật khẩu hiện chữ để bạn copy gửi cho người dùng; đổi xong hãy tự xoá khỏi clipboard.
      </p>
      {error && <p className="error" style={{ marginTop: 8 }}>{error}</p>}
    </form>
  );
}

function AccountLine({
  row,
  onPick,
  onOpen,
  onChanged,
}: {
  row: AccountRow;
  onPick: (account: AccountRow) => void;
  onOpen: (account: AccountRow) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirming, setConfirming] = useState(false);

  async function toggleLock() {
    const locking = row.status === 'active';
    // Khoá là thao tác ảnh hưởng người khác: bắt xác nhận tại chỗ, không dùng
    // window.confirm (hộp thoại của trình duyệt, dễ bị chặn và không nhất quán).
    if (locking && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setBusy('lock');
    setError(null);
    try {
      await callAdminUsers({ action: locking ? 'lock' : 'unlock', userId: row.user_id });
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không đổi được trạng thái');
    } finally {
      setBusy(null);
    }
  }

  async function resetPassword() {
    if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      setError('Mật khẩu mới phải từ 8 ký tự, có chữ và số.');
      return;
    }
    setBusy('reset');
    setError(null);
    try {
      await callAdminUsers({ action: 'reset-password', userId: row.user_id, password: newPassword });
      setResetting(false);
      setNewPassword('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không đặt lại được mật khẩu');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <tr>
        <td>
          <button className="link" onClick={() => onOpen(row)} title="Xem chi tiết tiến trình">
            {row.username}
          </button>
          <div className="muted mono">{shortId(row.user_id)}</div>
        </td>
        <td>
          <span className={`badge ${row.role === 'admin' ? 'badge-admin' : ''}`}>{row.role}</span>
        </td>
        <td>
          <span className={`badge ${row.status === 'active' ? 'badge-active' : 'badge-locked'}`}>
            {row.status === 'active' ? 'hoạt động' : 'bị khoá'}
          </span>
        </td>
        <td className="num">{num(Number(row.word_count))}</td>
        <td className="num">{num(Number(row.due_count))}</td>
        <td className="num">{num(Number(row.review_count))}</td>
        <td className="num">{num(Number(row.coin_balance))}</td>
        <td>{dateTime(row.last_review_at)}</td>
        <td>{dateTime(row.created_at)}</td>
        <td>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn small-btn" onClick={() => onPick(row)}>Xu</button>
            <button className="btn small-btn" onClick={() => setResetting((v) => !v)}>Mật khẩu</button>
            <button
              className={`btn small-btn ${row.status === 'active' ? 'danger' : ''}`}
              onClick={() => void toggleLock()}
              disabled={busy === 'lock'}
            >
              {busy === 'lock' ? '…' : row.status === 'active' ? (confirming ? 'Chắc chắn khoá?' : 'Khoá') : 'Mở'}
            </button>
            {confirming && (
              <button className="btn small-btn ghost" onClick={() => setConfirming(false)}>
                Huỷ
              </button>
            )}
          </div>
          {resetting && (
            <div className="row" style={{ marginTop: 6 }}>
              <input
                type="text"
                placeholder="Mật khẩu mới"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                style={{ width: 150 }}
              />
              <button className="btn small-btn primary" onClick={() => void resetPassword()} disabled={busy === 'reset'}>
                {busy === 'reset' ? '…' : 'Lưu'}
              </button>
            </div>
          )}
          {error && <p className="error small" style={{ marginTop: 6 }}>{error}</p>}
        </td>
      </tr>
    </>
  );
}

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  adjustCoins,
  errorMessage,
  loadAccounts,
  loadCoinHistory,
  type AccountRow,
  type CoinRow,
} from '../lib/api';
import { supabase } from '../lib/supabase';
import { dateTime, num, shortId } from '../lib/format';

export default function Coins({
  selected,
  onSelect,
}: {
  selected: AccountRow | null;
  onSelect: (account: AccountRow | null) => void;
}) {
  if (!selected) return <Picker onSelect={onSelect} />;
  return <Detail account={selected} onBack={() => onSelect(null)} />;
}

function Picker({ onSelect }: { onSelect: (account: AccountRow) => void }) {
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await loadAccounts(search, 0, 25));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tải được danh sách');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section>
      <h1>Xu</h1>
      <p className="muted small">Chọn một tài khoản để xem số dư, điều chỉnh và xem lịch sử giao dịch.</p>
      <div className="card" style={{ marginTop: 16 }}>
        <input
          style={{ width: '100%' }}
          placeholder="Tìm tài khoản…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th>Tên đăng nhập</th>
                <th>Vai trò</th>
                <th className="num">Số dư xu</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.user_id}>
                  <td>
                    {row.username}
                    <div className="muted mono">{shortId(row.user_id)}</div>
                  </td>
                  <td><span className="badge">{row.role}</span></td>
                  <td className="num">{num(Number(row.coin_balance))}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn small-btn" onClick={() => onSelect(row)}>Chọn</button>
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted" style={{ padding: 18 }}>Không có tài khoản nào.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
      </div>
    </section>
  );
}

function Detail({ account, onBack }: { account: AccountRow; onBack: () => void }) {
  const [balance, setBalance] = useState<number | null>(null);
  const [history, setHistory] = useState<CoinRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState<{ amount: number; reason: string; sourceId: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [{ data: balanceData, error: balanceError }, rows] = await Promise.all([
        supabase.rpc('admin_coin_balance', { p_user_id: account.user_id }),
        loadCoinHistory(account.user_id),
      ]);
      if (balanceError) throw new Error(errorMessage(balanceError));
      setBalance(Number(balanceData ?? 0));
      setHistory(rows);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tải được số dư');
    }
  }, [account.user_id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function prepare(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    setError(null);
    const parsed = Number(amount);
    if (!Number.isInteger(parsed) || parsed === 0) {
      setError('Số xu phải là số nguyên khác 0 (dùng dấu trừ để trừ xu).');
      return;
    }
    if (!reason.trim()) {
      setError('Bắt buộc ghi lý do — lịch sử giao dịch phải giải thích được.');
      return;
    }
    if (balance !== null && balance + parsed < 0) {
      setError(`Số dư hiện tại là ${num(balance)}; trừ ${num(Math.abs(parsed))} sẽ thành số âm.`);
      return;
    }
    // Mã giao dịch sinh tại đây, không phải lúc gửi: bấm "Xác nhận" lần hai
    // (do mạng lỗi, hoặc người dùng sốt ruột) gửi lại CÙNG mã nên không nhân đôi.
    setPending({ amount: parsed, reason: reason.trim(), sourceId: `admin-${crypto.randomUUID()}` });
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await adjustCoins({
        userId: account.user_id,
        amount: pending.amount,
        reason: pending.reason,
        sourceId: pending.sourceId,
      });
      setPending(null);
      setAmount('');
      setReason('');
      setNotice(`Đã ghi giao dịch ${pending.amount > 0 ? '+' : ''}${num(pending.amount)} xu.`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không ghi được giao dịch');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="spread">
        <div>
          <h1>Xu · {account.username}</h1>
          <p className="muted small mono">{account.user_id}</p>
        </div>
        <button className="btn ghost" onClick={onBack}>← Chọn tài khoản khác</button>
      </div>

      <div className="grid" style={{ marginTop: 16 }}>
        <div className="stat">
          <div className="label">Số dư hiện tại</div>
          <div className="value">{balance === null ? '…' : num(balance)}</div>
        </div>
        <div className="stat">
          <div className="label">Trạng thái</div>
          <div className="value" style={{ fontSize: 18 }}>
            {account.status === 'active' ? 'hoạt động' : 'bị khoá'}
          </div>
        </div>
      </div>

      <form className="card" style={{ marginTop: 16 }} onSubmit={prepare}>
        <h2>Điều chỉnh xu</h2>
        <div className="row" style={{ marginTop: 10 }}>
          <label className="field" style={{ width: 160 }}>
            <span>Số xu (+ cộng / − trừ)</span>
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="vd 50 hoặc -20"
              inputMode="numeric"
            />
          </label>
          <label className="field" style={{ flex: 1, minWidth: 220 }}>
            <span>Lý do (bắt buộc, sẽ nằm trong lịch sử)</span>
            <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="vd: bù lỗi đồng bộ" />
          </label>
          <button className="btn primary" type="submit" disabled={busy}>Xem lại</button>
        </div>

        {pending && (
          <div className="note" style={{ marginTop: 12 }}>
            <p style={{ margin: 0 }}>
              Sắp ghi: <strong>{pending.amount > 0 ? '+' : ''}{num(pending.amount)} xu</strong> cho{' '}
              <strong>{account.username}</strong>, lý do “{pending.reason}”.
              {balance !== null && <> Số dư sau: {num(balance + pending.amount)}.</>}
            </p>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn primary" type="button" onClick={() => void confirm()} disabled={busy}>
                {busy ? 'Đang ghi…' : 'Xác nhận'}
              </button>
              <button className="btn ghost" type="button" onClick={() => setPending(null)} disabled={busy}>
                Huỷ
              </button>
            </div>
          </div>
        )}

        {notice && <p className="ok" style={{ marginTop: 10 }}>{notice}</p>}
        {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
        <p className="muted small" style={{ marginTop: 10 }}>
          Mọi thay đổi đi qua hàm <span className="mono">admin_adjust_coins</span>: có khoá chống ghi trùng,
          không cho số dư âm, và không xoá lịch sử cũ.
        </p>
      </form>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="spread">
          <h2>Lịch sử giao dịch</h2>
          <button className="btn small-btn" onClick={() => void refresh()}>Làm mới</button>
        </div>
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table>
            <thead>
              <tr>
                <th>Thời điểm</th>
                <th>Loại</th>
                <th className="num">Thay đổi</th>
                <th className="num">Số dư sau</th>
                <th>Lý do</th>
                <th>Nguồn</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row) => (
                <tr key={row.id}>
                  <td>{dateTime(row.created_at)}</td>
                  <td><span className="badge">{row.kind}</span></td>
                  <td className="num" style={{ color: row.amount > 0 ? 'var(--ok)' : 'var(--danger)' }}>
                    {row.amount > 0 ? '+' : ''}{num(row.amount)}
                  </td>
                  <td className="num">{num(row.balance_after)}</td>
                  <td>{row.reason ?? '—'}</td>
                  <td className="muted mono">{row.source_id.slice(0, 18)}</td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted" style={{ padding: 18 }}>Chưa có giao dịch nào.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  loadStreakInfo,
  loadUserActivity,
  loadUserDetail,
  loadUserWords,
  setStreak,
  type AccountRow,
  type ActivityRow,
  type StreakInfo,
  type UserDetail as Detail,
  type UserWordRow,
  type WordFilter,
} from '../lib/api';
import { dateTime, levelShort, num } from '../lib/format';

const FILTERS: { id: WordFilter; label: string }[] = [
  { id: 'all', label: 'Tất cả' },
  { id: 'due', label: 'Đến hạn' },
  { id: 'forgotten', label: 'Hay quên' },
  { id: 'mastered', label: 'Đã thuộc' },
];

const STATE_LABEL: Record<string, string> = {
  new: 'mới',
  learning: 'đang học',
  review: 'ôn tập',
  mastered: 'đã thuộc',
};

const RATING_LABEL: Record<string, string> = {
  forgot: 'chưa nhớ',
  hard: 'khó',
  good: 'dễ',
  easy: 'rất dễ',
};

export default function UserDetail({ account, onBack }: { account: AccountRow; onBack: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [words, setWords] = useState<UserWordRow[]>([]);
  const [filter, setFilter] = useState<WordFilter>('all');
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loadingWords, setLoadingWords] = useState(true);

  const loadHeader = useCallback(async () => {
    setError(null);
    try {
      const [d, a] = await Promise.all([loadUserDetail(account.user_id), loadUserActivity(account.user_id, 30)]);
      setDetail(d);
      setActivity(a);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tải được chi tiết');
    }
  }, [account.user_id]);

  const loadWords = useCallback(async () => {
    setLoadingWords(true);
    try {
      setWords(await loadUserWords(account.user_id, filter, page));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tải được danh sách từ');
    } finally {
      setLoadingWords(false);
    }
  }, [account.user_id, filter, page]);

  useEffect(() => {
    void loadHeader();
  }, [loadHeader]);

  useEffect(() => {
    void loadWords();
  }, [loadWords]);

  const total = words[0]?.total_count ?? 0;

  return (
    <section>
      <div className="spread">
        <div>
          <h1>{account.username}</h1>
          <p className="muted small mono">{account.user_id}</p>
        </div>
        <button className="btn ghost" onClick={onBack}>← Danh sách tài khoản</button>
      </div>

      {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}

      {detail && (
        <div className="grid" style={{ marginTop: 16 }}>
          <Stat label="Từ đang theo học" value={num(detail.words)} hint={`${num(detail.due)} đến hạn`} />
          <Stat label="Từ hay quên" value={num(detail.forgotten)} hint="sai nhiều hơn đúng" />
          <Stat label="Đã thuộc" value={num(detail.mastered)} hint={`${num(detail.learning)} đang học`} />
          <Stat
            label="Chính xác 7 ngày"
            value={detail.accuracy_7d === null ? '—' : `${detail.accuracy_7d}%`}
            hint={`${num(detail.reviews_7d)} lượt`}
          />
          {/* Số streak hiện tại nằm ở thẻ "Chuỗi ngày học" bên dưới: đó là chỗ
              duy nhất tính cả mốc điều chỉnh của quản trị viên, nên không lặp
              lại một con số cũ ở đây để tránh hai số khác nhau trên cùng trang. */}
          <Stat label="Lượt ôn hôm nay" value={num(detail.reviews_today)} hint={`tổng ${num(detail.reviews_total)}`} />
          <Stat label="Xu" value={num(detail.coins)} hint="tổng sổ giao dịch" />
          <Stat label="Lần ôn cuối" value={dateTime(detail.last_review_at)} hint={`tạo ${dateTime(detail.created_at)}`} />
        </div>
      )}

      <StreakCard userId={account.user_id} />

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Hoạt động 30 ngày</h2>
        {activity.length === 0 ? (
          <p className="muted small" style={{ marginTop: 8 }}>
            Chưa có dữ liệu hoạt động theo ngày cho tài khoản này.
          </p>
        ) : (
          <ActivityChart rows={activity} />
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="spread">
          <h2>Từ của người này</h2>
          <span className="small muted">{num(total)} từ</span>
        </div>

        <div className="row" style={{ marginTop: 10 }}>
          {FILTERS.map((item) => (
            <button
              key={item.id}
              className={`btn small-btn ${filter === item.id ? 'primary' : ''}`}
              onClick={() => {
                setFilter(item.id);
                setPage(0);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table>
            <thead>
              <tr>
                <th>Từ</th>
                <th>Level</th>
                <th>Trạng thái</th>
                <th>Đến hạn</th>
                <th className="num">Đúng</th>
                <th className="num">Sai</th>
                <th className="num">Gợi ý</th>
                <th>Tự đánh giá</th>
                <th>Sai gần nhất</th>
              </tr>
            </thead>
            <tbody>
              {words.map((row) => (
                <tr key={row.term_id}>
                  <td>{row.term}</td>
                  <td><span className="badge">{levelShort(row.level)}</span></td>
                  <td>{STATE_LABEL[row.learning_state] ?? row.learning_state}</td>
                  <td>{dateTime(row.due_at)}</td>
                  <td className="num">{num(row.correct_count)}</td>
                  <td className="num" style={{ color: row.wrong_count > 0 ? 'var(--danger)' : undefined }}>
                    {num(row.wrong_count)}
                  </td>
                  <td className="num">{num(row.hint_count)}</td>
                  <td>{row.memory_rating ? RATING_LABEL[row.memory_rating] ?? row.memory_rating : '—'}</td>
                  <td>{dateTime(row.last_wrong_at)}</td>
                </tr>
              ))}
              {!loadingWords && words.length === 0 && (
                <tr>
                  <td colSpan={9} className="muted" style={{ padding: 18 }}>
                    Không có từ nào trong nhóm này.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="pager">
          <button className="btn" disabled={page === 0} onClick={() => setPage((p) => Math.max(p - 1, 0))}>
            ← Trước
          </button>
          <span className="small muted">Trang {page + 1} · {num(total)} từ</span>
          <button className="btn" disabled={words.length < 50} onClick={() => setPage((p) => p + 1)}>
            Sau →
          </button>
        </div>
      </div>
    </section>
  );
}

/**
 * Chuỗi ngày học: xem, điều chỉnh và lịch sử.
 *
 * Điều chỉnh không ghi vào `daily_activity` (đó là số liệu thật của người học)
 * mà tạo một mốc `streak_grants`. App đọc mốc mới nhất qua `my_streak_baseline`,
 * nên thay đổi có tác dụng trên mọi thiết bị và vẫn tiếp tục tăng tự nhiên khi
 * người học hoàn thành mục tiêu ngày hôm sau.
 */
function StreakCard({ userId }: { userId: string }) {
  const [info, setInfo] = useState<StreakInfo | null>(null);
  const [days, setDays] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await loadStreakInfo(userId);
      setInfo(next);
      setDays((current) => (current === '' ? String(next.current) : current));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tải được streak');
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const value = Number(days);
    if (!Number.isInteger(value) || value < 0 || value > 3650) {
      setError('Số ngày phải là số nguyên từ 0 đến 3650.');
      return;
    }
    if (reason.trim().length < 3) {
      setError('Cần nêu lý do (ít nhất 3 ký tự) để lưu nhật ký quản trị.');
      return;
    }
    const ok = window.confirm(
      `Đặt chuỗi ngày học của tài khoản này thành ${value} ngày?\n\nLý do: ${reason.trim()}\n\n` +
        'Thay đổi áp dụng trên mọi thiết bị ở lần đồng bộ kế tiếp. Không cộng xu và không đổi lịch sử học.',
    );
    if (!ok) return;

    setBusy(true);
    try {
      await setStreak({ userId, days: value, reason: reason.trim() });
      setReason('');
      setNotice(`Đã đặt streak = ${value} ngày.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không lưu được');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="spread">
        <h2>Chuỗi ngày học (streak)</h2>
        <span className="badge">Streak hiện tại: {info ? num(info.current) : '—'}</span>
      </div>

      {info && (
        <>
          <div className="grid" style={{ marginTop: 12 }}>
            <Stat label="Streak hiện tại" value={num(info.current)} hint="tính từ dữ liệu đã đồng bộ" />
            <Stat label="Streak dài nhất" value={num(info.longest)} hint="cao nhất từ trước tới nay" />
            <Stat label="Ngày hoạt động cuối" value={info.lastDay ?? '—'} hint="ngày có trả lời câu hỏi" />
            <Stat label="Ngày đạt mục tiêu cuối" value={info.lastGoalDay ?? '—'} hint="cơ sở để nối chuỗi" />
            <Stat label="Hôm nay (UTC)" value={info.today} hint="mốc điều chỉnh được tính theo ngày này" />
          </div>

          {info.grant && (
            <p className="muted small" style={{ marginTop: 8 }}>
              Đang áp mốc điều chỉnh <strong>{num(info.grant.days)} ngày</strong> từ{' '}
              {info.grant.date} — lý do: “{info.grant.reason}”. Các ngày đạt mục tiêu sau mốc vẫn
              được cộng tiếp vào chuỗi.
            </p>
          )}

          <form onSubmit={(event) => void submit(event)} style={{ marginTop: 16 }}>
            <h3 style={{ marginBottom: 8 }}>Điều chỉnh</h3>
            <div className="row">
              <label className="field" style={{ minWidth: 140 }}>
                <span>Đặt streak thành (ngày)</span>
                <input
                  type="number"
                  min={0}
                  max={3650}
                  value={days}
                  onChange={(event) => setDays(event.target.value)}
                  required
                />
              </label>
              <label className="field" style={{ flex: 1, minWidth: 220 }}>
                <span>Lý do (bắt buộc, lưu vào nhật ký)</span>
                <input
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Ví dụ: người học mất máy, xác nhận qua chat ngày 12/10"
                  maxLength={300}
                  required
                />
              </label>
              <button className="btn primary" type="submit" disabled={busy} style={{ alignSelf: 'flex-end' }}>
                {busy ? 'Đang lưu…' : 'Lưu điều chỉnh'}
              </button>
            </div>
            <p className="muted small" style={{ marginTop: 8 }}>
              Đặt 0 để huỷ chuỗi. Không cộng xu hay nhân hệ số xu — đây là thao tác hỗ trợ,
              không phải phần thưởng kiếm được.
            </p>
          </form>

          {notice && <p className="small" style={{ color: 'var(--success, #15803d)', marginTop: 8 }}>{notice}</p>}
          {error && <p className="error" style={{ marginTop: 8 }}>{error}</p>}

          <h3 style={{ marginTop: 16, marginBottom: 8 }}>Lịch sử điều chỉnh</h3>
          {info.grants.length === 0 ? (
            <p className="muted small">Chưa có điều chỉnh nào.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Thời điểm</th>
                    <th className="num">Đặt thành</th>
                    <th>Lý do</th>
                    <th>Người thực hiện</th>
                  </tr>
                </thead>
                <tbody>
                  {info.grants.map((grant) => (
                    <tr key={grant.id}>
                      <td>{dateTime(grant.createdAt)}</td>
                      <td className="num">{num(grant.days)}</td>
                      <td>{grant.reason}</td>
                      <td>{grant.grantedByName ?? grant.grantedBy ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {!info && !error && <p className="muted small">Đang tải…</p>}
      {!info && error && <p className="error">{error}</p>}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value" style={{ fontSize: typeof value === 'string' && value.length > 12 ? 16 : undefined }}>
        {value}
      </div>
      {hint && <div className="muted small">{hint}</div>}
    </div>
  );
}

/** Biểu đồ cột thuần CSS — không thêm thư viện chỉ để vẽ 30 cột. */
function ActivityChart({ rows }: { rows: ActivityRow[] }) {
  const max = Math.max(...rows.map((r) => r.reviews), 1);
  return (
    <div>
      <div className="chart" role="img" aria-label={`Biểu đồ ${rows.length} ngày`}>
        {rows.map((row) => (
          <div key={row.day} className="chart-col" title={`${row.day}: ${row.reviews} lượt ôn, đúng ${row.correct}/${row.answered}`}>
            <div
              className="chart-bar"
              style={{ height: `${Math.max((row.reviews / max) * 100, row.reviews > 0 ? 4 : 0)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 6 }}>
        <span className="small muted">{rows[0]?.day}</span>
        <span className="small muted">cao nhất {max} lượt/ngày</span>
        <span className="small muted">{rows[rows.length - 1]?.day}</span>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { loadStats, type Stats } from '../lib/api';
import { dateTime, num } from '../lib/format';

export default function Overview() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStats(await loadStats());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tải được số liệu');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section>
      <div className="spread">
        <div>
          <h1>Tổng quan</h1>
          <p className="muted small">Số liệu đọc trực tiếp từ database, không phải dữ liệu mẫu.</p>
        </div>
        <button className="btn" onClick={() => void load()} disabled={loading}>
          {loading ? 'Đang tải…' : 'Làm mới'}
        </button>
      </div>

      {error && <p className="error" style={{ marginTop: 12 }}>{error}</p>}

      {stats && (
        <>
          <div className="grid" style={{ marginTop: 16 }}>
            <Stat label="Tài khoản" value={num(stats.accounts)} hint={`${num(stats.admins)} admin`} />
            <Stat label="Đang hoạt động" value={num(stats.active)} hint={`${num(stats.locked)} bị khoá`} />
            <Stat label="Từ trong từ điển" value={num(stats.terms)} />
            <Stat label="Từ đang theo học" value={num(stats.user_words)} hint={`${num(stats.due_today)} đến hạn`} />
            <Stat label="Lượt ôn hôm nay" value={num(stats.reviews_today)} hint={`${num(stats.reviews_7d)} trong 7 ngày`} />
            <Stat label="Xu đang lưu hành" value={num(stats.coins_out)} hint="tổng sổ giao dịch" />
            <Stat label="Lượt gọi AI hôm nay" value={num(stats.ai_calls_today)} hint={`${num(stats.ai_errors_today)} lỗi`} />
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h2>Lỗi AI gần nhất</h2>
            {stats.last_ai_error ? (
              <p className="small">
                <span className="mono">{stats.last_ai_error}</span>
                <br />
                <span className="muted">{dateTime(stats.last_ai_error_at)}</span>
              </p>
            ) : (
              <p className="muted small">
                Chưa ghi nhận lỗi. Lưu ý: bảng này chỉ có dữ liệu khi tính năng AI chạy qua backend —
                hiện app còn gọi Groq trực tiếp từ thiết bị nên chưa ghi vào đây.
              </p>
            )}
          </div>
        </>
      )}

      {loading && !stats && !error && <p className="muted" style={{ marginTop: 16 }}>Đang tải số liệu…</p>}
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint && <div className="muted small">{hint}</div>}
    </div>
  );
}

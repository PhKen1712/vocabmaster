import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { loadAiConfig, loadAiUsage, saveAiConfig, type AiConfig, type AiUsageRow } from '../lib/api';
import { dateTime, num, shortId } from '../lib/format';

const MODELS = ['openai/gpt-oss-120b', 'llama-3.1-8b-instant', 'gemini-3.8-flash'];

export default function AiSettings() {
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [usage, setUsage] = useState<AiUsageRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [cfg, rows] = await Promise.all([loadAiConfig(), loadAiUsage()]);
      setConfig(cfg);
      setUsage(rows);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không đọc được cấu hình');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!config) return;
    setError(null);
    setNotice(null);

    if (!config.ai_model.trim()) {
      setError('Model không được để trống.');
      return;
    }
    if (config.ai_daily_limit < 0) {
      setError('Hạn mức mỗi ngày không được âm.');
      return;
    }
    if (config.ai_max_batch < 1 || config.ai_max_batch > 100) {
      setError('Số mục mỗi lần gọi phải trong khoảng 1–100.');
      return;
    }

    setBusy(true);
    try {
      await saveAiConfig({
        ai_enabled: config.ai_enabled,
        ai_provider: config.ai_provider,
        ai_model: config.ai_model.trim(),
        ai_daily_limit: config.ai_daily_limit,
        ai_max_batch: config.ai_max_batch,
      });
      setNotice('Đã lưu cấu hình.');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không lưu được');
    } finally {
      setBusy(false);
    }
  }

  if (!config) {
    return (
      <section>
        <h1>Groq / AI</h1>
        <p className={error ? 'error' : 'muted'} style={{ marginTop: 12 }}>
          {error ?? 'Đang tải cấu hình…'}
        </p>
      </section>
    );
  }

  return (
    <section>
      <div className="spread">
        <div>
          <h1>Groq / AI</h1>
          <p className="muted small">Cấu hình dùng chung cho mọi tài khoản; lưu trong bảng `app_config`.</p>
        </div>
        <button className="btn" onClick={() => void refresh()} disabled={busy}>Làm mới</button>
      </div>

      <div className="note" style={{ marginTop: 16 }}>
        <strong>API key không nằm ở đây.</strong> Khoá Groq/Gemini phải là secret của backend (Edge Function),
        không bao giờ lưu trong bảng hay gửi xuống trình duyệt. Hiện app vẫn gọi Groq trực tiếp từ thiết bị bằng
        khoá trong Keychain, nên trang này chỉ quản lý model, bật/tắt và hạn mức. Khi có Edge Function proxy AI,
        nút “Kiểm tra kết nối” mới có việc để làm.
      </div>

      <form className="card" style={{ marginTop: 16 }} onSubmit={submit}>
        <h2>Cấu hình</h2>
        <div className="row" style={{ marginTop: 10 }}>
          <label className="field" style={{ width: 120 }}>
            <span>Bật AI</span>
            <select
              value={config.ai_enabled ? 'yes' : 'no'}
              onChange={(event) => setConfig({ ...config, ai_enabled: event.target.value === 'yes' })}
            >
              <option value="yes">Bật</option>
              <option value="no">Tắt</option>
            </select>
          </label>
          <label className="field" style={{ width: 160 }}>
            <span>Nhà cung cấp</span>
            <select
              value={config.ai_provider}
              onChange={(event) => setConfig({ ...config, ai_provider: event.target.value as AiConfig['ai_provider'] })}
            >
              <option value="groq">Groq</option>
              <option value="gemini">Gemini</option>
            </select>
          </label>
          <label className="field" style={{ flex: 1, minWidth: 220 }}>
            <span>Model</span>
            <input
              list="model-options"
              value={config.ai_model}
              onChange={(event) => setConfig({ ...config, ai_model: event.target.value })}
            />
            <datalist id="model-options">
              {MODELS.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
          </label>
          <label className="field" style={{ width: 150 }}>
            <span>Hạn mức/ngày</span>
            <input
              type="number"
              min={0}
              value={config.ai_daily_limit}
              onChange={(event) => setConfig({ ...config, ai_daily_limit: Number(event.target.value) })}
            />
          </label>
          <label className="field" style={{ width: 150 }}>
            <span>Mục mỗi lần gọi</span>
            <input
              type="number"
              min={1}
              max={100}
              value={config.ai_max_batch}
              onChange={(event) => setConfig({ ...config, ai_max_batch: Number(event.target.value) })}
            />
          </label>
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'Đang lưu…' : 'Lưu cấu hình'}
          </button>
          <button
            className="btn"
            type="button"
            disabled
            title="Chưa có Edge Function proxy AI nên không có khoá phía server để kiểm tra."
          >
            Kiểm tra kết nối (chưa khả dụng)
          </button>
        </div>

        {notice && <p className="ok" style={{ marginTop: 10 }}>{notice}</p>}
        {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
        <p className="muted small" style={{ marginTop: 10 }}>
          Lưu lần cuối: {dateTime(config.updated_at)}
          {config.last_error && (
            <>
              {' · '}Lỗi gần nhất: <span className="mono">{config.last_error}</span> ({dateTime(config.last_error_at)})
            </>
          )}
        </p>
      </form>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Mức sử dụng</h2>
        {usage.length === 0 ? (
          <p className="muted small" style={{ marginTop: 8 }}>
            Chưa có số liệu. Bảng `ai_usage` chỉ được ghi khi AI gọi qua backend; app hiện gọi trực tiếp từ
            thiết bị nên chưa có dòng nào.
          </p>
        ) : (
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table>
              <thead>
                <tr>
                  <th>Ngày</th>
                  <th>Tài khoản</th>
                  <th className="num">Lượt gọi</th>
                  <th className="num">Lỗi</th>
                  <th>Lỗi gần nhất</th>
                </tr>
              </thead>
              <tbody>
                {usage.map((row) => (
                  <tr key={`${row.user_id}-${row.day}`}>
                    <td>{row.day}</td>
                    <td className="mono">{shortId(row.user_id)}</td>
                    <td className="num">{num(row.calls)}</td>
                    <td className="num">{num(row.errors)}</td>
                    <td>{row.last_error ? <span className="mono small">{row.last_error}</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

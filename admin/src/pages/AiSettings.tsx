import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  loadAiConfig,
  loadAiUsage,
  loadGroqKeyStatus,
  saveAiConfig,
  saveGroqKey,
  testGroqProxy,
  type AiConfig,
  type AiUsageRow,
  type GroqKeyStatus,
} from '../lib/api';
import { dateTime, num, shortId } from '../lib/format';

const MODELS = ['openai/gpt-oss-120b', 'llama-3.1-8b-instant', 'gemini-3.8-flash'];

export default function AiSettings() {
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [usage, setUsage] = useState<AiUsageRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [keyStatus, setKeyStatus] = useState<GroqKeyStatus | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [cfg, rows, status] = await Promise.all([
        loadAiConfig(),
        loadAiUsage(),
        loadGroqKeyStatus(),
      ]);
      setConfig(cfg);
      setUsage(rows);
      setKeyStatus(status);
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

  async function submitKey(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setTestResult(null);
    const value = keyInput.trim();
    if (value && !value.startsWith('gsk_')) {
      setError('Khoá Groq bắt đầu bằng "gsk_".');
      return;
    }
    setKeyBusy(true);
    try {
      const status = await saveGroqKey(value);
      setKeyStatus(status);
      setKeyInput('');
      setNotice(status.configured ? 'Đã lưu khoá Groq trên server.' : 'Đã xoá khoá Groq khỏi server.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không lưu được khoá');
    } finally {
      setKeyBusy(false);
    }
  }

  async function runTest() {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await testGroqProxy());
    } finally {
      setTesting(false);
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
        <strong>Thành viên không cần tự nhập key.</strong> App gọi Edge Function <span className="mono">ai-proxy</span>;
        function giữ khoá Groq, kiểm tra tài khoản và hạn mức rồi mới gọi Groq. Khoá không bao giờ đi xuống
        trình duyệt hay điện thoại, và cột khoá trong database đã bị thu hồi quyền đọc qua API. Đổi khoá ở đây
        có hiệu lực ngay, không phải build lại IPA.
      </div>

      <form className="card" style={{ marginTop: 16 }} onSubmit={submitKey}>
        <h2>Khoá Groq dùng chung</h2>
        <p className="muted small" style={{ marginTop: 6 }}>
          Trạng thái: {keyStatus?.configured ? <strong>đã cấu hình</strong> : <strong>chưa có</strong>}
          {keyStatus?.configured && keyStatus.masked ? (
            <>
              {' '}· <span className="mono">{keyStatus.masked}</span>
            </>
          ) : null}
        </p>
        <div className="row" style={{ marginTop: 10 }}>
          <label className="field" style={{ flex: 1, minWidth: 240 }}>
            <span>Khoá mới (để trống và bấm Lưu để xoá khoá)</span>
            <input
              type="password"
              value={keyInput}
              onChange={(event) => setKeyInput(event.target.value)}
              placeholder="gsk_..."
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <button className="btn primary" type="submit" disabled={keyBusy} style={{ alignSelf: 'flex-end' }}>
            {keyBusy ? 'Đang lưu…' : 'Lưu khoá'}
          </button>
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>
          Nếu project đã đặt secret <span className="mono">GROQ_API_KEY</span> cho function, secret đó được ưu tiên
          hơn khoá lưu trong database. Khoá chỉ hiển thị dạng che, không đọc lại được.
        </p>
      </form>

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
          <button className="btn" type="button" disabled={testing} onClick={() => void runTest()}>
            {testing ? 'Đang kiểm tra…' : 'Kiểm tra kết nối'}
          </button>
        </div>
        {testResult && (
          <p className={testResult.ok ? 'ok' : 'error'} style={{ marginTop: 10 }}>
            {testResult.ok ? '✓ ' : '✗ '}
            {testResult.detail}
          </p>
        )}

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
            Chưa có số liệu. Bảng `ai_usage` chỉ được ghi khi người học dùng khoá dùng chung (đi qua
            Edge Function `ai-proxy`). Người đã tự nhập khoá riêng thì gọi thẳng Groq từ thiết bị, không
            đi qua đây — và cũng không tiêu hạn mức chung.
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

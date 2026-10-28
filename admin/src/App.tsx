import { useCallback, useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, configProblem, redirectTo } from './lib/supabase';
import { errorMessage, isSessionExpired, type AccountRow } from './lib/api';
import Overview from './pages/Overview';
import Accounts from './pages/Accounts';
import UserDetail from './pages/UserDetail';
import Dictionary from './pages/Dictionary';
import Coins from './pages/Coins';
import AiSettings from './pages/AiSettings';

type Tab = 'overview' | 'accounts' | 'user' | 'dictionary' | 'coins' | 'ai';

/**
 * Màn hình nào đang chiếm toàn trang khi CHƯA có quyền vào bảng quản trị.
 *
 * - `login`    : đăng nhập bằng email + mật khẩu.
 * - `forgot`   : xin liên kết đặt lại mật khẩu qua email.
 * - `recovery` : người dùng vừa bấm liên kết trong email → đặt mật khẩu mới.
 */
type Mode = 'login' | 'forgot' | 'recovery';

interface AdminProfile {
  username: string;
  role: string;
  status: string;
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Tổng quan' },
  { id: 'accounts', label: 'Tài khoản' },
  { id: 'dictionary', label: 'Từ điển' },
  { id: 'coins', label: 'Xu' },
  { id: 'ai', label: 'Groq / AI' },
];

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AdminProfile | null>(null);
  const [gateError, setGateError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState<Tab>('overview');
  const [selected, setSelected] = useState<AccountRow | null>(null);
  const [detail, setDetail] = useState<AccountRow | null>(null);
  const [mode, setMode] = useState<Mode>('login');
  const [notice, setNotice] = useState<string | null>(null);

  const checkAccess = useCallback(async (current: Session | null) => {
    if (!current) {
      setProfile(null);
      setGateError(null);
      setChecking(false);
      return;
    }
    const { data, error } = await supabase
      .from('profiles')
      .select('username,role,status')
      .eq('user_id', current.user.id)
      .maybeSingle();

    if (error) {
      // Phiên đã hết hạn hoặc token bị thu hồi: đừng để người dùng nhìn mã lỗi
      // PostgREST khô khan, mà đưa thẳng về màn đăng nhập.
      if (isSessionExpired(error)) {
        setGateError('Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.');
        setProfile(null);
        setChecking(false);
        void supabase.auth.signOut();
        return;
      }
      setGateError(`Không đọc được hồ sơ: ${errorMessage(error)}`);
      setProfile(null);
    } else if (!data) {
      setGateError('Tài khoản này chưa có hồ sơ trong hệ thống.');
      setProfile(null);
    } else if (data.status !== 'active') {
      setGateError('Tài khoản đang bị khoá.');
      setProfile(null);
    } else if (data.role !== 'admin') {
      setGateError('Tài khoản này không có quyền quản trị.');
      setProfile(null);
    } else {
      setGateError(null);
      setProfile(data as AdminProfile);
    }
    setChecking(false);
  }, []);

  useEffect(() => {
    if (configProblem) {
      setChecking(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      void checkAccess(data.session);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (event === 'PASSWORD_RECOVERY') {
        // Người dùng vừa bấm liên kết trong email: ưu tiên đặt mật khẩu mới.
        setMode('recovery');
        setChecking(false);
        return;
      }
      if (event === 'SIGNED_OUT') setMode('login');
      // QUAN TRỌNG: không gọi supabase.* trực tiếp trong callback này.
      // supabase-js đang giữ khoá phiên trong lúc phát sự kiện, nên một request
      // đi ngay tại đây sẽ chờ chính khoá đó → treo ở "Cẩn thẩm định quyền…".
      // Đẩy sang microtask sau khi khoá được nhả.
      setTimeout(() => void checkAccess(next), 0);
    });
    return () => listener.subscription.unsubscribe();
  }, [checkAccess]);

  if (configProblem) return <Fatal text={configProblem} />;
  if (mode === 'recovery') {
    return (
      <SetPassword
        onDone={() => {
          setMode('login');
          setNotice('Đã đổi mật khẩu. Hãy đăng nhập bằng mật khẩu mới.');
        }}
      />
    );
  }
  if (mode === 'forgot') {
    return (
      <ForgotPassword
        onBack={() => setMode('login')}
        onSent={(email) => {
          setMode('login');
          setNotice(`Đã gửi liên kết đặt lại mật khẩu tới ${email}. Kiểm tra cả thư mục spam.`);
        }}
      />
    );
  }
  if (checking) return <Centered>Cẩn thẩm định quyền…</Centered>;
  if (!session) return <Login notice={notice} onForgot={() => { setNotice(null); setMode('forgot'); }} />;
  if (!profile) {
    return (
      <Centered>
        <div className="card narrow">
          <h2>Không vào được</h2>
          <p className="muted">{gateError ?? 'Không xác định được quyền.'}</p>
          <button className="btn" onClick={() => supabase.auth.signOut()}>
            Đăng xuất
          </button>
        </div>
      </Centered>
    );
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="dot" />
          <div>
            <strong>VocabMaster</strong>
            <div className="muted small">Quản trị</div>
          </div>
        </div>
        <nav>
          {TABS.map((item) => {
            // Khi đang xem chi tiết một người, tab "Tài khoản" vẫn sáng.
            const active = tab === item.id || (item.id === 'accounts' && tab === 'user');
            return (
              <button
                key={item.id}
                className={`nav ${active ? 'active' : ''}`}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <div className="small muted">Đăng nhập</div>
          <div>{profile.username}</div>
          <RoleBadge role={profile.role} />
          <button className="btn ghost small-btn" onClick={() => supabase.auth.signOut()}>
            Đăng xuất
          </button>
        </div>
      </aside>

      <main className="content">
        {tab === 'overview' && <Overview />}
        {tab === 'accounts' && (
          <Accounts
            onPick={(account) => {
              setSelected(account);
              setTab('coins');
            }}
            onOpen={(account) => {
              setDetail(account);
              setTab('user');
            }}
          />
        )}
        {tab === 'user' &&
          (detail ? (
            <UserDetail account={detail} onBack={() => setTab('accounts')} />
          ) : (
            <p className="muted">Chọn một tài khoản ở tab Tài khoản.</p>
          ))}
        {tab === 'dictionary' && <Dictionary />}
        {tab === 'coins' && <Coins selected={selected} onSelect={setSelected} />}
        {tab === 'ai' && <AiSettings />}
      </main>
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  return <span className={`badge ${role === 'admin' ? 'badge-admin' : ''}`}>{role}</span>;
}

function Login({
  notice,
  onForgot,
}: {
  notice: string | null;
  onForgot: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: signError } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (signError) {
      setError(describeAuthError(signError));
      return;
    }
  }

  return (
    <Centered>
      <form className="card narrow" onSubmit={submit}>
        <h1>VocabMaster</h1>
        <p className="muted small">Bảng quản trị. Chỉ tài khoản có quyền admin mới vào được.</p>
        {notice && <p className="ok">{notice}</p>}
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>Mật khẩu</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
        </button>
        <button className="btn ghost small-btn" type="button" onClick={onForgot} disabled={busy}>
          Quên mật khẩu?
        </button>
      </form>
    </Centered>
  );
}

/** Đổi lỗi thô của GoTrue thành câu tiếng Việt đọc được. */
function describeAuthError(error: { message?: string; code?: string; status?: number }): string {
  const message = error.message ?? '';
  if (/invalid login credentials/i.test(message)) return 'Sai email hoặc mật khẩu.';
  if (/email not confirmed/i.test(message)) {
    return 'Email này chưa được xác nhận. Dùng "Quên mật khẩu?" để nhận liên kết xác nhận, hoặc xác nhận trong Supabase → Authentication → Users.';
  }
  if (/banned|locked|disabled/i.test(message)) return 'Tài khoản này đang bị khoá.';
  if (/rate limit|too many/i.test(message)) return 'Quá nhiều lần thử. Đợi một lát rồi thử lại.';
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return 'Không gọi được Supabase. Kiểm tra mạng, hoặc VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY trong admin/.env.';
  }
  return message || 'Đăng nhập thất bại.';
}

function ForgotPassword({
  onBack,
  onSent,
}: {
  onBack: () => void;
  onSent: (email: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: sendError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo,
    });
    setBusy(false);
    if (sendError) {
      setError(describeAuthError(sendError));
      return;
    }
    onSent(email.trim());
  }

  return (
    <Centered>
      <form className="card narrow" onSubmit={submit}>
        <h1>Đặt lại mật khẩu</h1>
        <p className="muted small">
          Nhập email của tài khoản quản trị. Supabase sẽ gửi liên kết để đặt mật khẩu mới.
        </p>
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Đang gửi…' : 'Gửi liên kết'}
        </button>
        <button className="btn ghost small-btn" type="button" onClick={onBack} disabled={busy}>
          ← Về đăng nhập
        </button>
      </form>
    </Centered>
  );
}

/** Màn hình sau khi bấm liên kết trong email (sự kiện PASSWORD_RECOVERY). */
function SetPassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < 8) {
      setError('Mật khẩu cần ít nhất 8 ký tự.');
      return;
    }
    if (password !== confirm) {
      setError('Hai lần nhập mật khẩu không khớp.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setBusy(false);
      setError(describeAuthError(updateError));
      return;
    }
    // Đặt xong thì đăng xuất để người dùng vào lại bằng mật khẩu vừa tạo —
    // vừa xác nhận mật khẩu hoạt động, vừa không để sót phiên từ liên kết email.
    await supabase.auth.signOut();
    setBusy(false);
    onDone();
  }

  return (
    <Centered>
      <form className="card narrow" onSubmit={submit}>
        <h1>Mật khẩu mới</h1>
        <p className="muted small">Liên kết trong email đã được xác nhận. Đặt mật khẩu mới cho tài khoản.</p>
        <label className="field">
          <span>Mật khẩu mới</span>
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </label>
        <label className="field">
          <span>Nhập lại mật khẩu</span>
          <input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            minLength={8}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Đang lưu…' : 'Lưu mật khẩu'}
        </button>
      </form>
    </Centered>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="centered">{children}</div>;
}

function Fatal({ text }: { text: string }) {
  return (
    <Centered>
      <div className="card narrow">
        <h2>Chưa cấu hình</h2>
        <p className="error">{text}</p>
      </div>
    </Centered>
  );
}

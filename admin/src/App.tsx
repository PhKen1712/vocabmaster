import { useCallback, useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, configProblem } from './lib/supabase';
import { errorMessage, type AccountRow } from './lib/api';
import Overview from './pages/Overview';
import Accounts from './pages/Accounts';
import UserDetail from './pages/UserDetail';
import Dictionary from './pages/Dictionary';
import Coins from './pages/Coins';
import AiSettings from './pages/AiSettings';

type Tab = 'overview' | 'accounts' | 'user' | 'dictionary' | 'coins' | 'ai';

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
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      void checkAccess(next);
    });
    return () => listener.subscription.unsubscribe();
  }, [checkAccess]);

  if (configProblem) return <Fatal text={configProblem} />;
  if (checking) return <Centered>Cẩn thẩm định quyền…</Centered>;
  if (!session) return <Login onDone={() => undefined} />;
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

function Login({ onDone }: { onDone: () => void }) {
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
      setError(
        /invalid login/i.test(signError.message)
          ? 'Sai email hoặc mật khẩu.'
          : /banned|locked/i.test(signError.message)
            ? 'Tài khoản này đang bị khoá.'
            : signError.message,
      );
      return;
    }
    onDone();
  }

  return (
    <Centered>
      <form className="card narrow" onSubmit={submit}>
        <h1>VocabMaster</h1>
        <p className="muted small">Bảng quản trị. Chỉ tài khoản có quyền admin mới vào được.</p>
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

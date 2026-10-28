import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Session } from '@supabase/supabase-js';

import { cloudConfigHint, cloudConfigured } from './config';
import { clearStoredSession, getCloudClient, resetCloudClient } from './client';

export type AuthStatus = 'unavailable' | 'checking' | 'signedOut' | 'signedIn';

interface AuthContextValue {
  status: AuthStatus;
  /** Email đang đăng nhập, null khi chưa đăng nhập. */
  email: string | null;
  userId: string | null;
  /** Có cấu hình Supabase hay chưa. Thiếu cấu hình thì KHÔNG vào được ứng dụng. */
  available: boolean;
  configHint: string | null;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<{ needsEmailConfirm: boolean }>;
  signOut: () => Promise<void>;
  /** Đọc lại hồ sơ để biết tài khoản còn hoạt động hay không. */
  recheckAccess: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Dịch lỗi GoTrue sang tiếng Việt, thay vì show nguyên văn tiếng Anh. */
function describe(error: unknown): string {
  const message =
    typeof error === 'string' ? error : ((error as { message?: string })?.message ?? '');
  if (/invalid login credentials/i.test(message)) return 'Sai email hoặc mật khẩu.';
  if (/email not confirmed/i.test(message)) {
    return 'Tài khoản chưa xác nhận email. Mở hộp thư để xác nhận, hoặc nhờ quản trị viên tạo lại tài khoản.';
  }
  if (/user already registered/i.test(message)) return 'Email này đã có tài khoản. Hãy đăng nhập.';
  if (/password should be at least/i.test(message)) return 'Mật khẩu cần ít nhất 6 ký tự.';
  if (/rate limit|too many/i.test(message)) return 'Quá nhiều lần thử. Đợi một lát rồi thử lại.';
  if (/signups not allowed|disabled/i.test(message)) {
    return 'Hệ thống đang tắt tự đăng ký. Hãy nhờ quản trị viên tạo tài khoản cho bạn.';
  }
  if (/failed to fetch|network|load failed/i.test(message)) {
    return 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại — dữ liệu học trên máy vẫn nguyên.';
  }
  return message || 'Không thực hiện được. Thử lại giúp mình.';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(cloudConfigured ? 'checking' : 'unavailable');
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Chặn vòng lặp kiểm tra khi token được làm mới liên tục. */
  const verified = useRef<string | null>(null);

  /**
   * Kiểm tra tài khoản còn được phép dùng hay không.
   *
   * Đăng nhập được KHÔNG có nghĩa là còn quyền: quản trị viên có thể đã khoá tài
   * khoản. RLS cũng chặn dữ liệu khi bị khoá, nên phải phát hiện ngay lúc vào
   * ứng dụng thay vì để người học thấy một loạt lỗi đồng bộ khó hiểu.
   */
  const verifyAccess = useCallback(async (current: Session | null): Promise<boolean> => {
    const client = getCloudClient();
    if (!client || !current) return true;
    const { data, error: profileError } = await client
      .from('profiles')
      .select('status')
      .eq('user_id', current.user.id)
      .maybeSingle();

    // Lỗi mạng / RLS tạm thời không phải bằng chứng tài khoản bị khoá: để người
    // dùng vào và các thông báo đồng bộ sẽ nói rõ chuyện gì đang xảy ra.
    if (profileError) return true;

    if (!data) {
      await hardSignOut();
      setError('Tài khoản này chưa có hồ sơ trong hệ thống. Nhờ quản trị viên tạo lại.');
      return false;
    }
    if ((data as { status?: string }).status !== 'active') {
      await hardSignOut();
      setError('Tài khoản đang bị khoá. Liên hệ quản trị viên để được mở lại.');
      return false;
    }
    return true;
  }, []);

  useEffect(() => {
    const client = getCloudClient();
    if (!client) {
      setStatus('unavailable');
      return;
    }

    let cancelled = false;
    client.auth
      .getSession()
      .then(async ({ data }) => {
        if (cancelled) return;
        const restored = data.session ?? null;
        if (restored) {
          verified.current = restored.user.id;
          const allowed = await verifyAccess(restored);
          if (cancelled) return;
          if (!allowed) {
            setSession(null);
            setStatus('signedOut');
            return;
          }
        }
        setSession(restored);
        setStatus(restored ? 'signedIn' : 'signedOut');
      })
      .catch(() => {
        if (!cancelled) setStatus('signedOut');
      });

    const { data: listener } = client.auth.onAuthStateChange((event, next) => {
      if (cancelled) return;
      setSession(next);
      setStatus(next ? 'signedIn' : 'signedOut');
      if (!next) {
        verified.current = null;
        return;
      }
      // Chỉ kiểm tra hồ sơ một lần cho mỗi người dùng: TOKEN_REFRESHED bắn rất
      // thường xuyên và không cần hỏi lại mỗi lần.
      if (verified.current === next.user.id) return;
      verified.current = next.user.id;
      if (event === 'SIGNED_OUT') return;
      void (async () => {
        const allowed = await verifyAccess(next);
        if (cancelled || allowed) return;
        setSession(null);
        setStatus('signedOut');
      })();
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [verifyAccess]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const client = getCloudClient();
      if (!client) throw new Error(cloudConfigHint ?? 'Chưa cấu hình Supabase.');
      setError(null);
      const { data, error: signInError } = await client.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        const text = describe(signInError);
        setError(text);
        throw new Error(text);
      }
      if (data.session) {
        verified.current = data.session.user.id;
        const allowed = await verifyAccess(data.session);
        if (!allowed) {
          // verifyAccess đã đăng xuất và đặt câu giải thích.
          throw new Error('Tài khoản không dùng được. Xem thông báo phía trên.');
        }
      }
    },
    [verifyAccess],
  );

  const signUp = useCallback(
    async (email: string, password: string) => {
      const client = getCloudClient();
      if (!client) throw new Error(cloudConfigHint ?? 'Chưa cấu hình Supabase.');
      setError(null);
      const { data, error: signUpError } = await client.auth.signUp({
        email: email.trim(),
        password,
      });
      if (signUpError) {
        const text = describe(signUpError);
        setError(text);
        throw new Error(text);
      }
      // Không có session nghĩa là server yêu cầu xác nhận email trước.
      return { needsEmailConfirm: !data.session };
    },
    [],
  );

  const signOut = useCallback(async () => {
    const client = getCloudClient();
    verified.current = null;
    try {
      await client?.auth.signOut();
    } catch {
      // Mất mạng hoặc token hỏng: vẫn phải xoá phiên trên MÁY. Nếu không người
      // dùng sẽ kẹt ở trạng thái "đã đăng nhập" mà không dùng được gì.
      try {
        await client?.auth.signOut({ scope: 'local' });
      } catch {
        await clearStoredSession();
      }
    }
    await clearStoredSession();
    resetCloudClient();
    setSession(null);
    setStatus('signedOut');
    setError(null);
  }, []);

  const recheckAccess = useCallback(async () => {
    const client = getCloudClient();
    if (!client) return;
    const { data } = await client.auth.getSession();
    if (!data.session) {
      setSession(null);
      setStatus('signedOut');
      return;
    }
    const allowed = await verifyAccess(data.session);
    if (allowed) {
      setSession(data.session);
      setStatus('signedIn');
    }
  }, [verifyAccess]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      email: session?.user?.email ?? null,
      userId: session?.user?.id ?? null,
      available: cloudConfigured,
      configHint: cloudConfigHint,
      error,
      signIn,
      signUp,
      signOut,
      recheckAccess,
      clearError: () => setError(null),
    }),
    [status, session, error, signIn, signUp, signOut, recheckAccess],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Đăng xuất "cứng": dùng trong lúc kiểm tra quyền, khi chưa có state nào để dọn. */
async function hardSignOut(): Promise<void> {
  const client = getCloudClient();
  try {
    await client?.auth.signOut({ scope: 'local' });
  } catch {
    await clearStoredSession();
  }
  await clearStoredSession();
  resetCloudClient();
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

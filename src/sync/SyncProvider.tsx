import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useAuth } from '../cloud/AuthProvider';
import { pendingCount } from './outbox';
import { syncNow, type SyncOutcome } from './engine';
import { useApp } from '../state/AppProvider';

export type SyncPhase = 'off' | 'idle' | 'syncing' | 'synced' | 'error';

interface SyncContextValue {
  phase: SyncPhase;
  /** Số thay đổi còn nằm trên máy, chưa lên tài khoản. */
  pending: number;
  lastSyncedAt: string | null;
  message: string | null;
  /** Đồng bộ ngay. `full` = gửi toàn bộ thư viện trên máy lên tài khoản. */
  sync: (options?: { full?: boolean; silent?: boolean }) => Promise<SyncOutcome>;
  /** Đánh dấu có thay đổi mới; việc đồng bộ diễn ra sau một nhịp ngắn. */
  markDirty: () => void;
}

const SyncContext = createContext<SyncContextValue | null>(null);

/** Gộp nhiều thay đổi liên tiếp thành một lần gửi, tránh spam request. */
const DEBOUNCE_MS = 1500;

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { db, settings, dataVersion } = useApp();
  const { status, userId } = useAuth();
  const [phase, setPhase] = useState<SyncPhase>('off');
  const [pending, setPending] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const refreshPending = useCallback(async () => {
    if (!db) return;
    try {
      setPending(await pendingCount(db));
    } catch {
      // Đếm không được thì thôi; không phải lỗi của người học.
    }
  }, [db]);

  const sync = useCallback(
    async (options: { full?: boolean; silent?: boolean } = {}): Promise<SyncOutcome> => {
      if (!db || status !== 'signedIn') {
        return { ok: false, pushed: 0, pulled: 0, error: 'Chưa đăng nhập.' };
      }
      // Một vòng chạy tại một thời điểm: hai vòng song song sẽ đẩy trùng dữ liệu
      // và làm mốc thời gian nhảy lung tung.
      if (running.current) return { ok: false, pushed: 0, pulled: 0, error: 'Đang đồng bộ.' };
      running.current = true;
      if (!options.silent) setPhase('syncing');

      try {
        const outcome = await syncNow(db, { settings: settingsRef.current, full: options.full });
        if (outcome.ok) {
          setPhase('synced');
          setMessage(null);
          setLastSyncedAt(new Date().toISOString());
        } else {
          setPhase('error');
          setMessage(outcome.error ?? 'Không đồng bộ được.');
        }
        await refreshPending();
        return outcome;
      } catch (error) {
        const text = error instanceof Error ? error.message : 'Không đồng bộ được.';
        setPhase('error');
        setMessage(text);
        return { ok: false, pushed: 0, pulled: 0, error: text };
      } finally {
        running.current = false;
      }
    },
    [db, refreshPending, status],
  );

  const markDirty = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void sync({ silent: true });
    }, DEBOUNCE_MS);
  }, [sync]);

  // Đăng nhập xong thì đồng bộ ngay; đăng xuất thì trạng thái về "tắt".
  useEffect(() => {
    if (status === 'signedIn' && db) {
      void sync();
      void refreshPending();
      return;
    }
    if (status === 'signedOut' || status === 'unavailable') {
      setPhase('off');
      setPending(0);
      setMessage(null);
    }
  }, [status, userId, db, sync, refreshPending]);

  // Mỗi lần dữ liệu đổi (thêm từ, trả lời, đổi cài đặt…) là một lần gửi gộp.
  useEffect(() => {
    if (status !== 'signedIn') return;
    if (dataVersion === 0) return;
    markDirty();
  }, [dataVersion, status, markDirty]);

  // Quay lại ứng dụng sau một thời gian dài (mở máy tính lên làm việc tiếp) là
  // lúc dễ lệch dữ liệu nhất: kéo về một lần cho chắc.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active' && status === 'signedIn') void sync({ silent: true });
    });
    return () => subscription.remove();
  }, [status, sync]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const value = useMemo<SyncContextValue>(
    () => ({ phase, pending, lastSyncedAt, message, sync, markDirty }),
    [phase, pending, lastSyncedAt, message, sync, markDirty],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const context = useContext(SyncContext);
  if (!context) throw new Error('useSync must be used inside SyncProvider');
  return context;
}

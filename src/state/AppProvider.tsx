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
import type { SQLiteDatabase } from 'expo-sqlite';

import { pruneAiCache } from '../ai/cache';
import { getDailyStats } from '../db/activity';
import { getDatabase, seedDatabase } from '../db/database';
import { loadSettings, saveSettings } from '../db/settings';
import type { DailyStats, Settings } from '../types';
import { DEFAULT_SETTINGS } from '../types';
import { syncWidgets } from '../widgets/sync';

interface AppContextValue {
  db: SQLiteDatabase | null;
  ready: boolean;
  bootError: string | null;
  settings: Settings;
  stats: DailyStats | null;
  /** Increments after every data mutation so screens can refetch. */
  dataVersion: number;
  refresh: () => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<Settings>;
  notifyDataChanged: () => Promise<void>;
  widgetStatus: string | null;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<SQLiteDatabase | null>(null);
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [stats, setStats] = useState<DailyStats | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [widgetStatus, setWidgetStatus] = useState<string | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const database = await getDatabase();
        if (cancelled) return;
        await seedDatabase(database);
        // Drop cached AI explanations nobody has asked for in 180 days.
        // Best effort: a failed prune must never stop the app from opening.
        void pruneAiCache(database, 180 * 24 * 60 * 60 * 1000);
        const loaded = await loadSettings(database);
        if (cancelled) return;
        setDb(database);
        setSettings(loaded);
        const initialStats = await getDailyStats(database, loaded.track, loaded);
        if (cancelled) return;
        setStats(initialStats);
        setReady(true);
        void syncWidgets(database, loaded).then((result) => {
          if (!result.ok) setWidgetStatus(result.reason ?? 'Widget chưa cập nhật.');
        });
      } catch (error) {
        if (cancelled) return;
        setBootError(
          error instanceof Error
            ? error.message
            : 'Không mở được cơ sở dữ liệu trên thiết bị.',
        );
        setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    const database = db;
    if (!database) return;
    try {
      const next = await getDailyStats(database, settingsRef.current.track, settingsRef.current);
      setStats(next);
      setDataVersion((value) => value + 1);
    } catch {
      // Keep showing the last good statistics instead of clearing the screen.
    }
  }, [db]);

  const notifyDataChanged = useCallback(async () => {
    const database = db;
    if (!database) return;
    setDataVersion((value) => value + 1);
    try {
      const next = await getDailyStats(database, settingsRef.current.track, settingsRef.current);
      setStats(next);
    } catch {
      // Statistics are refreshed on the next foreground event.
    }
    const result = await syncWidgets(database, settingsRef.current);
    setWidgetStatus(result.ok ? null : (result.reason ?? 'Widget chưa cập nhật.'));
  }, [db]);

  const updateSettings = useCallback(
    async (patch: Partial<Settings>) => {
      const database = db;
      const merged = { ...settingsRef.current, ...patch };
      setSettings(merged);
      if (database) {
        const saved = await saveSettings(database, merged);
        setSettings(saved);
        settingsRef.current = saved;
        void syncWidgets(database, saved);
        const next = await getDailyStats(database, saved.track, saved);
        setStats(next);
        return saved;
      }
      return merged;
    },
    [db],
  );

  // Refresh statistics and widgets whenever the app returns to the foreground.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active' && db) {
        void refresh();
        void syncWidgets(db, settingsRef.current);
      }
    });
    return () => subscription.remove();
  }, [db, refresh]);

  const value = useMemo<AppContextValue>(
    () => ({
      db,
      ready,
      bootError,
      settings,
      stats,
      dataVersion,
      refresh,
      updateSettings,
      notifyDataChanged,
      widgetStatus,
    }),
    [
      db,
      ready,
      bootError,
      settings,
      stats,
      dataVersion,
      refresh,
      updateSettings,
      notifyDataChanged,
      widgetStatus,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider');
  return context;
}

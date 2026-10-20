import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

import type { Level, Track, WordInput } from '../types';

export type SessionMode = 'mixed' | 'review' | 'new' | 'weak' | 'topic';

export type TabName = 'today' | 'study' | 'words' | 'stats' | 'settings';

export interface SessionConfig {
  mode: SessionMode;
  track: Track;
  topic?: string | null;
  level?: Level;
}

export type Route =
  | { name: 'today' }
  | { name: 'study' }
  | { name: 'words' }
  | { name: 'stats' }
  | { name: 'settings' }
  | { name: 'word'; id: string }
  | { name: 'wordForm'; id?: string; draft?: WordInput }
  | { name: 'ai' }
  | { name: 'session'; config: SessionConfig }
  | { name: 'placement' };

export const TAB_ROUTES: TabName[] = ['today', 'study', 'words', 'stats', 'settings'];

interface NavigationContextValue {
  current: Route;
  stack: Route[];
  push: (route: Route) => void;
  pop: () => void;
  goToTab: (tab: TabName) => void;
  canGoBack: boolean;
}

const NavigationContext = createContext<NavigationContextValue | null>(null);

export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const [stack, setStack] = useState<Route[]>([{ name: 'today' }]);

  const push = useCallback((route: Route) => {
    setStack((previous) => [...previous, route]);
  }, []);

  const pop = useCallback(() => {
    setStack((previous) => (previous.length > 1 ? previous.slice(0, -1) : previous));
  }, []);

  const goToTab = useCallback((tab: TabName) => {
    setStack([{ name: tab } as Route]);
  }, []);

  const current = stack[stack.length - 1] ?? { name: 'today' };

  const value = useMemo<NavigationContextValue>(
    () => ({
      current,
      stack,
      push,
      pop,
      goToTab,
      canGoBack: stack.length > 1,
    }),
    [current, stack, push, pop, goToTab],
  );

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation(): NavigationContextValue {
  const context = useContext(NavigationContext);
  if (!context) throw new Error('useNavigation must be used inside NavigationProvider');
  return context;
}

import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';

import type { ThemeMode } from '../types';
import { darkPalette, lightPalette, type Palette } from './tokens';

interface ThemeContextValue {
  colors: Palette;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
  colors: lightPalette,
  isDark: false,
});

export function ThemeProvider({
  mode,
  children,
}: {
  mode: ThemeMode;
  children: React.ReactNode;
}) {
  const system = useColorScheme();
  const isDark = mode === 'dark' || (mode === 'system' && system === 'dark');

  const value = useMemo<ThemeContextValue>(
    () => ({ colors: isDark ? darkPalette : lightPalette, isDark }),
    [isDark],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

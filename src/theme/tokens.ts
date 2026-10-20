/**
 * Single source of truth for colour, spacing, radius and type scale.
 * Every screen imports these tokens through useTheme(), never hard-coded hex
 * values, so light/dark mode and future redesigns stay consistent.
 */

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 44,
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 26,
  pill: 999,
} as const;

export const typography = {
  display: { fontSize: 34, lineHeight: 40, fontWeight: '800' as const, letterSpacing: -0.6 },
  title: { fontSize: 26, lineHeight: 32, fontWeight: '700' as const, letterSpacing: -0.3 },
  headline: { fontSize: 20, lineHeight: 26, fontWeight: '700' as const },
  body: { fontSize: 16, lineHeight: 23, fontWeight: '400' as const },
  bodyStrong: { fontSize: 16, lineHeight: 23, fontWeight: '600' as const },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '500' as const },
  micro: { fontSize: 11, lineHeight: 15, fontWeight: '600' as const, letterSpacing: 0.4 },
  button: { fontSize: 17, lineHeight: 22, fontWeight: '700' as const },
} as const;

export interface Palette {
  background: string;
  surface: string;
  surfaceAlt: string;
  surfaceStrong: string;
  text: string;
  textMuted: string;
  textFaint: string;
  border: string;
  primary: string;
  primarySoft: string;
  onPrimary: string;
  accent: string;
  accentSoft: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  overlay: string;
  gradientStart: string;
  gradientEnd: string;
  general: string;
  ielts: string;
}

export const lightPalette: Palette = {
  background: '#F5F6FB',
  surface: '#FFFFFF',
  surfaceAlt: '#EEF1FA',
  surfaceStrong: '#1B2140',
  text: '#141A2E',
  textMuted: '#5C6480',
  textFaint: '#8C94AD',
  border: '#E3E7F2',
  primary: '#4C4EF5',
  primarySoft: '#E9E9FF',
  onPrimary: '#FFFFFF',
  accent: '#0FA97F',
  accentSoft: '#DDF7EE',
  success: '#128A5B',
  successSoft: '#DCF5E9',
  warning: '#B4690E',
  warningSoft: '#FDF0D8',
  danger: '#C43C4B',
  dangerSoft: '#FCE4E7',
  overlay: 'rgba(16, 20, 38, 0.45)',
  gradientStart: '#4C4EF5',
  gradientEnd: '#7B5CFA',
  general: '#2F7BF6',
  ielts: '#8B4DF5',
};

export const darkPalette: Palette = {
  background: '#080C16',
  surface: '#121829',
  surfaceAlt: '#1A2236',
  surfaceStrong: '#E9ECFF',
  text: '#F3F5FF',
  textMuted: '#A2ABC4',
  textFaint: '#78829D',
  border: '#243049',
  primary: '#8E99FF',
  primarySoft: '#22284A',
  onPrimary: '#0A0F1E',
  accent: '#43D3A4',
  accentSoft: '#14352C',
  success: '#4CD6A0',
  successSoft: '#123327',
  warning: '#F2B45C',
  warningSoft: '#3A2B15',
  danger: '#FF8794',
  dangerSoft: '#3B1D23',
  overlay: 'rgba(0, 0, 0, 0.6)',
  gradientStart: '#6E74FF',
  gradientEnd: '#9B6BFF',
  general: '#6EA8FF',
  ielts: '#BF9BFF',
};

export const shadows = {
  card: {
    shadowColor: '#0B1020',
    shadowOpacity: 0.06,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  floating: {
    shadowColor: '#0B1020',
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 6,
  },
} as const;

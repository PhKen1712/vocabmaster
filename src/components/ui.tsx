import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextProps,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../theme/ThemeProvider';
import { radius, shadows, spacing, typography } from '../theme/tokens';

type TextVariant = keyof typeof typography;

export function AppText({
  variant = 'body',
  color,
  style,
  children,
  ...rest
}: TextProps & { variant?: TextVariant; color?: string }) {
  const { colors } = useTheme();
  return (
    <Text
      {...rest}
      style={[typography[variant], { color: color ?? colors.text }, style]}
      allowFontScaling
      maxFontSizeMultiplier={1.3}
    >
      {children}
    </Text>
  );
}

export function Screen({
  children,
  scroll = true,
  style,
  contentStyle,
  edges = true,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  edges?: boolean;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const padding = {
    paddingTop: edges ? insets.top + spacing.sm : 0,
    paddingBottom: edges ? insets.bottom + spacing.xxl : spacing.xxl,
  };

  if (!scroll) {
    return (
      <View style={[styles.flex, { backgroundColor: colors.background }, style, padding]}>
        {children}
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: colors.background }, style]}
      contentContainerStyle={[padding, { paddingHorizontal: spacing.xl }, contentStyle]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

export function Card({
  children,
  style,
  soft = false,
  onPress,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  soft?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const { colors, isDark } = useTheme();
  const base: StyleProp<ViewStyle> = [
    styles.card,
    {
      backgroundColor: soft ? colors.surfaceAlt : colors.surface,
      borderColor: colors.border,
    },
    !isDark && shadows.card,
    style,
  ];

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        style={({ pressed }) => [base, pressed && { opacity: 0.82 }]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={base}>{children}</View>;
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  loading,
  icon,
  variant = 'primary',
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  icon?: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const background =
    variant === 'primary'
      ? colors.primary
      : variant === 'danger'
        ? colors.danger
        : variant === 'secondary'
          ? colors.primarySoft
          : 'transparent';
  const foreground =
    variant === 'primary'
      ? colors.onPrimary
      : variant === 'danger'
        ? '#FFFFFF'
        : colors.primary;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled || loading) }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: background,
          borderColor: variant === 'ghost' ? colors.border : 'transparent',
          opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={foreground} />
      ) : (
        <AppText variant="button" color={foreground} style={styles.buttonLabel}>
          {icon ? `${icon}  ${label}` : label}
        </AppText>
      )}
    </Pressable>
  );
}

export function Chip({
  label,
  active,
  onPress,
  tone = 'neutral',
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  tone?: 'neutral' | 'general' | 'ielts' | 'success' | 'warning' | 'danger';
}) {
  const { colors } = useTheme();
  const toneColor =
    tone === 'general'
      ? colors.general
      : tone === 'ielts'
        ? colors.ielts
        : tone === 'success'
          ? colors.success
          : tone === 'warning'
            ? colors.warning
            : tone === 'danger'
              ? colors.danger
              : colors.textMuted;

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={label}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          borderColor: active ? toneColor : colors.border,
          backgroundColor: active ? `${toneColor}22` : colors.surface,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <AppText variant="caption" color={active ? toneColor : colors.textMuted}>
        {label}
      </AppText>
    </Pressable>
  );
}

export function ProgressBar({
  value,
  height = 8,
  tone,
}: {
  value: number;
  height?: number;
  tone?: string;
}) {
  const { colors } = useTheme();
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <View
      style={{
        height,
        borderRadius: height,
        backgroundColor: colors.surfaceAlt,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          width: `${clamped * 100}%`,
          height: '100%',
          borderRadius: height,
          backgroundColor: tone ?? colors.primary,
        }}
      />
    </View>
  );
}

export function SectionHeader({
  title,
  actionLabel,
  onAction,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.sectionHeader}>
      <AppText variant="headline">{title}</AppText>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} accessibilityRole="button" hitSlop={8}>
          <AppText variant="caption" color={colors.primary}>
            {actionLabel}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

export function StatTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.statTile, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <AppText variant="micro" color={colors.textFaint}>
        {label.toUpperCase()}
      </AppText>
      <AppText variant="title" color={tone ?? colors.text} style={{ marginTop: 2 }}>
        {value}
      </AppText>
      {hint ? (
        <AppText variant="caption" color={colors.textMuted}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

export function EmptyState({
  emoji,
  title,
  body,
  actionLabel,
  onAction,
}: {
  emoji: string;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.empty}>
      <AppText style={{ fontSize: 40 }}>{emoji}</AppText>
      <AppText variant="headline" style={{ marginTop: spacing.md, textAlign: 'center' }}>
        {title}
      </AppText>
      <AppText
        variant="body"
        color={colors.textMuted}
        style={{ marginTop: spacing.sm, textAlign: 'center' }}
      >
        {body}
      </AppText>
      {actionLabel && onAction ? (
        <PrimaryButton
          label={actionLabel}
          onPress={onAction}
          style={{ marginTop: spacing.lg, alignSelf: 'stretch' }}
        />
      ) : null}
    </View>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <AppText variant="caption" color={colors.textMuted} style={{ marginBottom: spacing.xs }}>
        {label}
      </AppText>
      {children}
      {error ? (
        <AppText variant="caption" color={colors.danger} style={{ marginTop: spacing.xs }}>
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="caption" color={colors.textFaint} style={{ marginTop: spacing.xs }}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

export function Banner({
  tone = 'info',
  title,
  body,
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger';
  title: string;
  body?: string;
}) {
  const { colors } = useTheme();
  const map = {
    info: { bg: colors.primarySoft, fg: colors.primary },
    success: { bg: colors.successSoft, fg: colors.success },
    warning: { bg: colors.warningSoft, fg: colors.warning },
    danger: { bg: colors.dangerSoft, fg: colors.danger },
  } as const;
  const palette = map[tone];
  return (
    <View
      style={[
        styles.banner,
        { backgroundColor: palette.bg, borderColor: `${palette.fg}33` },
      ]}
    >
      <AppText variant="bodyStrong" color={palette.fg}>
        {title}
      </AppText>
      {body ? (
        <AppText variant="caption" color={palette.fg} style={{ marginTop: 2, opacity: 0.9 }}>
          {body}
        </AppText>
      ) : null}
    </View>
  );
}

export function Divider() {
  const { colors } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
  },
  button: {
    minHeight: 54,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  buttonLabel: { textAlign: 'center' },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xxl,
    marginBottom: spacing.md,
  },
  statTile: {
    flex: 1,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    minHeight: 86,
    justifyContent: 'center',
  },
  empty: {
    alignItems: 'center',
    paddingVertical: spacing.huge,
    paddingHorizontal: spacing.lg,
  },
  banner: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
});

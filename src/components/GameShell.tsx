import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useNavigation } from '../navigation/NavigationProvider';
import { ThemeProvider, useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/tokens';
import { AppText, Card, PrimaryButton } from './ui';

/**
 * The arcade screens are intentionally dark in both light and dark mode.
 *
 * Rather than hard-coding every colour, each screen re-provides the dark
 * palette through ThemeProvider. Shared components (cards, buttons, text) then
 * keep working without knowing they are on a game screen, and no light-mode
 * text ever ends up on a dark background.
 */
export function GameFrame({
  title,
  subtitle,
  right,
  onBack,
  children,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onBack?: () => void;
  children: React.ReactNode;
}) {
  return (
    <ThemeProvider mode="dark">
      <FrameInner title={title} subtitle={subtitle} right={right} onBack={onBack}>
        {children}
      </FrameInner>
    </ThemeProvider>
  );
}

function FrameInner({
  title,
  subtitle,
  right,
  onBack,
  children,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onBack?: () => void;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + spacing.sm },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Quay lại"
          onPress={onBack ?? navigation.pop}
          hitSlop={10}
          style={[styles.back, { backgroundColor: colors.surfaceAlt }]}
        >
          <AppText variant="bodyStrong" color={colors.text}>
            ‹
          </AppText>
        </Pressable>
        <View style={styles.flex}>
          <AppText variant="headline" numberOfLines={1}>
            {title}
          </AppText>
          {subtitle ? (
            <AppText variant="caption" color={colors.textMuted} numberOfLines={1}>
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {right}
      </View>
      <View style={styles.flex}>{children}</View>
    </View>
  );
}

export function HudPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: string;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.pill,
        { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
      ]}
    >
      <AppText variant="micro" color={colors.textFaint}>
        {label.toUpperCase()}
      </AppText>
      <AppText variant="bodyStrong" color={tone ?? colors.text}>
        {value}
      </AppText>
    </View>
  );
}

export interface OverlayStat {
  label: string;
  value: string | number;
  tone?: string;
}

export function GameOverlay({
  emoji,
  title,
  subtitle,
  stats,
  note,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
}: {
  emoji?: string;
  title: string;
  subtitle?: string;
  stats?: OverlayStat[];
  note?: string;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={[StyleSheet.absoluteFill, styles.overlay, { backgroundColor: colors.overlay }]}>
      <Card style={{ padding: spacing.xl }}>
        {emoji ? <AppText style={{ fontSize: 38 }}>{emoji}</AppText> : null}
        <AppText variant="title" style={{ marginTop: spacing.sm }}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="body" color={colors.textMuted} style={{ marginTop: spacing.sm }}>
            {subtitle}
          </AppText>
        ) : null}
        {stats && stats.length > 0 ? (
          <View style={styles.statRow}>
            {stats.map((stat) => (
              <View
                key={stat.label}
                style={[styles.stat, { backgroundColor: colors.surfaceAlt }]}
              >
                <AppText variant="micro" color={colors.textFaint}>
                  {stat.label.toUpperCase()}
                </AppText>
                <AppText variant="headline" color={stat.tone ?? colors.text}>
                  {stat.value}
                </AppText>
              </View>
            ))}
          </View>
        ) : null}
        {note ? (
          <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.md }}>
            {note}
          </AppText>
        ) : null}
        <PrimaryButton label={primaryLabel} onPress={onPrimary} style={{ marginTop: spacing.lg }} />
        {secondaryLabel && onSecondary ? (
          <PrimaryButton
            label={secondaryLabel}
            variant="ghost"
            onPress={onSecondary}
            style={{ marginTop: spacing.sm }}
          />
        ) : null}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  back: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    minWidth: 64,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  overlay: { justifyContent: 'center', padding: spacing.xl },
  statRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  stat: { flex: 1, borderRadius: radius.md, padding: spacing.md },
});

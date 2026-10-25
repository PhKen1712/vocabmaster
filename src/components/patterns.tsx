import React from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import { useNavigation } from '../navigation/NavigationProvider';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing, typography } from '../theme/tokens';
import { LEVEL_SHORT, TRACK_LABELS, type Level, type Track, type Word } from '../types';
import { displayTerm, formatList } from '../lib/text';
import { formatRelativeDue } from '../lib/date';
import { AppText, Card, Chip } from './ui';

export function ScreenHeader({
  title,
  subtitle,
  onBack,
  right,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
}) {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const goBack = onBack ?? navigation.pop;

  return (
    <View style={styles.header}>
      <View style={styles.headerRow}>
        {navigation.canGoBack || onBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Quay lại"
            onPress={goBack}
            hitSlop={12}
            style={[styles.backButton, { backgroundColor: colors.surfaceAlt }]}
          >
            <AppText variant="bodyStrong" color={colors.text}>
              ‹
            </AppText>
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }}>
          <AppText variant="title" numberOfLines={2}>
            {title}
          </AppText>
          {subtitle ? (
            <AppText variant="caption" color={colors.textMuted} style={{ marginTop: 2 }}>
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {right}
      </View>
    </View>
  );
}

export function TrackSwitcher({
  value,
  onChange,
}: {
  value: Track;
  onChange: (track: Track) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.segment, { backgroundColor: colors.surfaceAlt }]}>
      {(['general', 'ielts'] as Track[]).map((track) => {
        const active = track === value;
        return (
          <Pressable
            key={track}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(track)}
            style={[
              styles.segmentItem,
              active && { backgroundColor: colors.surface },
            ]}
          >
            <AppText
              variant="bodyStrong"
              color={active ? (track === 'ielts' ? colors.ielts : colors.general) : colors.textMuted}
            >
              {TRACK_LABELS[track]}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

export function LevelPicker({
  value,
  onChange,
}: {
  value: Level;
  onChange: (level: Level) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrapRow}>
      {([0, 1, 2, 3, 4, 5, 6] as Level[]).map((level) => {
        const active = level === value;
        return (
          <Pressable
            key={level}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(level)}
            style={[
              styles.levelChip,
              {
                borderColor: active ? colors.primary : colors.border,
                backgroundColor: active ? colors.primarySoft : colors.surface,
              },
            ]}
          >
            <AppText variant="caption" color={active ? colors.primary : colors.textMuted}>
              {LEVEL_SHORT[level]}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Stepper({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  const { colors } = useTheme();
  const change = (delta: number) => {
    const next = Math.min(max, Math.max(min, value + delta * step));
    onChange(next);
  };

  return (
    <View style={styles.stepperRow}>
      <View style={{ flex: 1 }}>
        <AppText variant="bodyStrong">{label}</AppText>
        <AppText variant="caption" color={colors.textMuted}>
          {value}
          {suffix ? ` ${suffix}` : ''}
        </AppText>
      </View>
      <View style={styles.stepperButtons}>
        {[-1, 1].map((direction) => (
          <Pressable
            key={direction}
            accessibilityRole="button"
            accessibilityLabel={direction === -1 ? `Giảm ${label}` : `Tăng ${label}`}
            onPress={() => change(direction)}
            style={[styles.stepperButton, { borderColor: colors.border, backgroundColor: colors.surface }]}
          >
            <AppText variant="headline" color={colors.primary}>
              {direction === -1 ? '−' : '+'}
            </AppText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function Input({
  value,
  onChangeText,
  placeholder,
  multiline,
  secureTextEntry,
  autoCapitalize = 'none',
  keyboardType,
  style,
  maxLength,
  onSubmitEditing,
  onBlur,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  multiline?: boolean;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  keyboardType?: 'default' | 'number-pad' | 'email-address';
  style?: StyleProp<TextStyle>;
  maxLength?: number;
  onSubmitEditing?: () => void;
  onBlur?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.textFaint}
      multiline={multiline}
      secureTextEntry={secureTextEntry}
      autoCapitalize={autoCapitalize}
      autoCorrect={false}
      keyboardType={keyboardType}
      maxLength={maxLength}
      onSubmitEditing={onSubmitEditing}
      onBlur={onBlur}
      style={[
        styles.input,
        typography.body,
        {
          color: colors.text,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          minHeight: multiline ? 88 : 48,
          textAlignVertical: multiline ? 'top' : 'center',
        },
        style,
      ]}
    />
  );
}

export function WordCard({
  word,
  onPress,
  onToggleFavorite,
}: {
  word: Word;
  onPress: () => void;
  onToggleFavorite?: () => void;
}) {
  const { colors } = useTheme();
  const favorite = word.isFavorite;
  const due = formatRelativeDue(word.dueAt);

  return (
    <Card onPress={onPress} style={{ marginBottom: spacing.md }} accessibilityLabel={`Từ ${word.term}`}>
      <View style={styles.wordRow}>
        <View style={{ flex: 1 }}>
          <View style={styles.wordTitleRow}>
            <AppText variant="headline" numberOfLines={1} style={{ flexShrink: 1 }}>
              {displayTerm(word.term)}
            </AppText>
            {word.ipa ? (
              <AppText variant="caption" color={colors.textFaint} style={{ marginLeft: 6 }}>
                {word.ipa}
              </AppText>
            ) : null}
          </View>
          <AppText variant="body" color={colors.textMuted} numberOfLines={2} style={{ marginTop: 2 }}>
            {word.meaningVi}
          </AppText>
          <View style={styles.badgeRow}>
            <AppText
              variant="micro"
              color={word.track === 'ielts' ? colors.ielts : colors.general}
            >
              {word.track === 'ielts' ? 'IELTS' : 'GENERAL'} · {LEVEL_SHORT[word.level]}
            </AppText>
            <AppText variant="micro" color={colors.textFaint}>
              {word.reps === 0 ? 'TỪ MỚI' : due.toUpperCase()}
            </AppText>
            {word.source === 'ai' ? (
              <AppText variant="micro" color={colors.warning}>
                AI
              </AppText>
            ) : null}
            {word.inAlbum ? (
              <AppText variant="micro" color={colors.primary}>
                ALBUM
              </AppText>
            ) : null}
          </View>
        </View>
        {onToggleFavorite ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={favorite ? 'Bỏ yêu thích' : 'Thêm vào yêu thích'}
            onPress={onToggleFavorite}
            hitSlop={10}
            style={styles.starButton}
          >
            <AppText variant="headline" color={favorite ? colors.warning : colors.textFaint}>
              {favorite ? '★' : '☆'}
            </AppText>
          </Pressable>
        ) : null}
      </View>
      {word.collocations.length > 0 ? (
        <AppText variant="caption" color={colors.textFaint} numberOfLines={1} style={{ marginTop: spacing.sm }}>
          {formatList(word.collocations.slice(0, 3))}
        </AppText>
      ) : null}
    </Card>
  );
}

export function ChipRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.wrapRow}>{children}</View>;
}

export function ChipButton({
  label,
  active,
  onPress,
  tone,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  tone?: 'general' | 'ielts' | 'success' | 'warning' | 'danger';
}) {
  return <Chip label={label} active={active} onPress={onPress} tone={tone} />;
}

export function ProgressRow({
  label,
  value,
  total,
  tone,
}: {
  label: string;
  value: number;
  total: number;
  tone?: string;
}) {
  const { colors } = useTheme();
  const ratio = total > 0 ? Math.min(1, value / total) : 0;
  return (
    <View style={{ marginBottom: spacing.md }}>
      <View style={styles.progressLabelRow}>
        <AppText variant="caption">{label}</AppText>
        <AppText variant="caption" color={colors.textMuted}>
          {value}/{total}
        </AppText>
      </View>
      <View style={[styles.barTrack, { backgroundColor: colors.surfaceAlt }]}>
        <View
          style={[
            styles.barFill,
            { width: `${ratio * 100}%`, backgroundColor: tone ?? colors.primary },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: spacing.lg },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segment: {
    flexDirection: 'row',
    borderRadius: radius.md,
    padding: 4,
    marginBottom: spacing.lg,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  levelChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    minWidth: 46,
    alignItems: 'center',
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  stepperButtons: { flexDirection: 'row', gap: spacing.sm },
  stepperButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  wordRow: { flexDirection: 'row', alignItems: 'flex-start' },
  wordTitleRow: { flexDirection: 'row', alignItems: 'baseline' },
  badgeRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm, flexWrap: 'wrap' },
  starButton: { paddingLeft: spacing.md, paddingTop: 2 },
  progressLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  barTrack: { height: 8, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4 },
});

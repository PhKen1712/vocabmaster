import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { getLevelBreakdown, getTopics, listWords } from '../db/words';
import { useNavigation } from '../navigation/NavigationProvider';
import { useApp } from '../state/AppProvider';
import { useTheme } from '../theme/ThemeProvider';
import { spacing } from '../theme/tokens';
import { LEVEL_LABELS, LEVEL_SHORT, type Level, type Track } from '../types';
import { AppText, Card, Chip, PrimaryButton, Screen, SectionHeader } from '../components/ui';
import { ChipRow, LevelPicker, ScreenHeader, Stepper, TrackSwitcher } from '../components/patterns';

interface LevelRow {
  level: number;
  total: number;
  learned: number;
}

export function StudyScreen() {
  const { db, settings, updateSettings, dataVersion, ready, stats } = useApp();
  const { push } = useNavigation();
  const { colors } = useTheme();
  const [levels, setLevels] = useState<LevelRow[]>([]);
  const [topics, setTopics] = useState<{ topic: string; count: number }[]>([]);
  const [dueCount, setDueCount] = useState(0);
  const [freshCount, setFreshCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [topic, setTopic] = useState<string | null>(null);

  const track = settings.track;

  const load = useCallback(async () => {
    if (!db) return;
    setLoading(true);
    try {
      const [breakdown, topicRows, fresh] = await Promise.all([
        getLevelBreakdown(db, track),
        getTopics(db, track),
        listWords(db, { track, limit: 500 }),
      ]);
      setLevels(breakdown);
      setTopics(topicRows);
      setFreshCount(fresh.filter((word) => word.reps === 0).length);
      const due = await db.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM words WHERE track = ? AND reps > 0 AND due_at <= ?;',
        [track, new Date().toISOString()],
      );
      setDueCount(due?.count ?? 0);
      if (topic && !topicRows.some((row) => row.topic === topic)) setTopic(null);
    } finally {
      setLoading(false);
    }
  }, [db, track, topic, dataVersion]);

  useEffect(() => {
    void load();
  }, [load]);

  const setTrack = (next: Track) => {
    setTopic(null);
    void updateSettings({ track: next });
  };

  const startTopic = () => {
    if (!topic) return;
    push({
      name: 'session',
      config: { mode: 'topic', track, topic, level: settings.level },
    });
  };

  const totalForLevel = (level: Level) =>
    levels.find((row) => row.level === level) ?? { level, total: 0, learned: 0 };

  if (!ready || loading) {
    return (
      <Screen scroll={false}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader title="Học" subtitle="Lộ trình và các dạng luyện tập" />

      <TrackSwitcher value={track} onChange={setTrack} />

      <Card style={{ marginBottom: spacing.lg }}>
        <AppText variant="micro" color={colors.textFaint}>
          CẤP ĐỘ HIỆN TẠI
        </AppText>
        <AppText variant="headline" style={{ marginTop: 2, marginBottom: spacing.md }}>
          {LEVEL_LABELS[settings.level]}
        </AppText>
        <LevelPicker
          value={settings.level}
          onChange={(level) => void updateSettings({ level })}
        />
        <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.md }}>
          Chọn cấp độ bạn muốn học. Từ mới sẽ ưu tiên đúng cấp độ này, sau đó tới các cấp thấp hơn
          để không bị hổng kiến thức.
        </AppText>
        <View style={{ marginTop: spacing.sm }}>
          <Stepper
            label="Mục tiêu mỗi ngày"
            value={settings.dailyGoal}
            min={1}
            max={100}
            step={5}
            suffix="lượt"
            onChange={(dailyGoal) => void updateSettings({ dailyGoal })}
          />
        </View>
        <PrimaryButton
          label="Kiểm tra đầu vào (tuỳ chọn)"
          variant="ghost"
          onPress={() => push({ name: 'placement' })}
        />
      </Card>

      {stats && stats.learnedCount >= 10 && stats.accuracy7d > 0
        ? (() => {
            const high = stats.accuracy7d >= 0.85 && settings.level < 6;
            const low = stats.accuracy7d <= 0.5 && settings.level > 0;
            if (!high && !low) return null;
            const nextLevel = (settings.level + (high ? 1 : -1)) as Level;
            return (
              <Card soft style={{ marginBottom: spacing.lg }}>
                <AppText variant="bodyStrong">Gợi ý điều chỉnh độ khó</AppText>
                <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.xs }}>
                  7 ngày qua bạn trả lời đúng {Math.round(stats.accuracy7d * 100)}%.{' '}
                  {high
                    ? 'Có vẻ bạn đang thấy dễ — thử tăng một cấp để học từ mới thử thách hơn.'
                    : 'Có vẻ hơi khó — giảm một cấp để củng cố nền tảng trước.'}
                </AppText>
                <PrimaryButton
                  label={`Chuyển sang ${LEVEL_SHORT[nextLevel]}`}
                  variant="secondary"
                  onPress={() => void updateSettings({ level: nextLevel })}
                  style={{ marginTop: spacing.md }}
                />
              </Card>
            );
          })()
        : null}

      <SectionHeader title="Luyện tập" />
      <Card style={{ marginBottom: spacing.md }} onPress={() => push({ name: 'session', config: { mode: 'mixed', track, level: settings.level } })}>
        <View style={styles.sessionRow}>
          <View style={{ flex: 1 }}>
            <AppText variant="bodyStrong">Buổi học tổng hợp</AppText>
            <AppText variant="caption" color={colors.textMuted}>
              {dueCount} từ cần ôn · {Math.min(settings.dailyGoal, freshCount)} từ mới
            </AppText>
          </View>
          <AppText variant="headline" color={colors.primary}>
            →
          </AppText>
        </View>
      </Card>

      <View style={styles.twoColumn}>
        <Card
          style={{ flex: 1 }}
          onPress={() => push({ name: 'session', config: { mode: 'review', track } })}
          accessibilityLabel="Chỉ ôn tập từ đến hạn"
        >
          <AppText style={{ fontSize: 22 }}>🔄</AppText>
          <AppText variant="bodyStrong" style={{ marginTop: spacing.sm }}>
            Ôn từ đến hạn
          </AppText>
          <AppText variant="caption" color={colors.textMuted}>
            {dueCount} từ
          </AppText>
        </Card>
        <Card
          style={{ flex: 1 }}
          onPress={() =>
            push({ name: 'session', config: { mode: 'new', track, level: settings.level } })
          }
          accessibilityLabel="Học từ mới"
        >
          <AppText style={{ fontSize: 22 }}>🌱</AppText>
          <AppText variant="bodyStrong" style={{ marginTop: spacing.sm }}>
            Học từ mới
          </AppText>
          <AppText variant="caption" color={colors.textMuted}>
            {freshCount} từ chưa học
          </AppText>
        </Card>
      </View>

      <View style={[styles.twoColumn, { marginTop: spacing.md }]}>
        <Card
          style={{ flex: 1 }}
          onPress={() => push({ name: 'session', config: { mode: 'weak', track } })}
          accessibilityLabel="Luyện từ hay sai"
        >
          <AppText style={{ fontSize: 22 }}>🎯</AppText>
          <AppText variant="bodyStrong" style={{ marginTop: spacing.sm }}>
            Từ hay sai
          </AppText>
          <AppText variant="caption" color={colors.textMuted}>
            Ưu tiên từ bạn quên
          </AppText>
        </Card>
        <Card style={{ flex: 1 }} onPress={() => push({ name: 'ai' })} accessibilityLabel="Tạo từ bằng Gemini">
          <AppText style={{ fontSize: 22 }}>✨</AppText>
          <AppText variant="bodyStrong" style={{ marginTop: spacing.sm }}>
            Gemini tạo bộ từ
          </AppText>
          <AppText variant="caption" color={colors.textMuted}>
            Theo chủ đề, cấp độ
          </AppText>
        </Card>
      </View>

      <SectionHeader title="Kiểm tra theo chủ đề" />
      {topics.length === 0 ? (
        <Card soft>
          <AppText variant="body" color={colors.textMuted}>
            Chưa có chủ đề nào. Thêm từ kèm chủ đề hoặc dùng Gemini để tạo bộ từ theo chủ đề.
          </AppText>
        </Card>
      ) : (
        <>
          <ChipRow>
            {topics.map((row) => (
              <Chip
                key={row.topic}
                label={`${row.topic} (${row.count})`}
                active={topic === row.topic}
                tone={track === 'ielts' ? 'ielts' : 'general'}
                onPress={() => setTopic(row.topic === topic ? null : row.topic)}
              />
            ))}
          </ChipRow>
          <PrimaryButton
            label={topic ? `Kiểm tra chủ đề ${topic}` : 'Chọn một chủ đề'}
            onPress={startTopic}
            disabled={!topic}
            style={{ marginTop: spacing.md }}
          />
        </>
      )}

      <SectionHeader title="Lộ trình cấp độ" />
      <AppText variant="caption" color={colors.textMuted} style={{ marginBottom: spacing.md }}>
        Một từ có thể phù hợp nhiều cấp độ; đây là gợi ý thứ tự học, không phải giới hạn cứng.
      </AppText>
      {([0, 1, 2, 3, 4, 5, 6] as Level[]).map((level) => {
        const row = totalForLevel(level);
        const progress = row.total > 0 ? row.learned / row.total : 0;
        const current = level === settings.level;
        return (
          <Card
            key={level}
            soft={!current}
            onPress={() => void updateSettings({ level })}
            style={{ marginBottom: spacing.sm }}
          >
            <View style={styles.levelRow}>
              <View
                style={[
                  styles.levelBadge,
                  {
                    backgroundColor: current ? colors.primary : colors.surfaceAlt,
                  },
                ]}
              >
                <AppText
                  variant="caption"
                  color={current ? colors.onPrimary : colors.textMuted}
                >
                  {LEVEL_SHORT[level]}
                </AppText>
              </View>
              <View style={{ flex: 1 }}>
                <AppText variant="bodyStrong">{LEVEL_LABELS[level]}</AppText>
                <AppText variant="caption" color={colors.textMuted}>
                  {row.learned}/{row.total} từ đã học
                </AppText>
              </View>
              <AppText variant="caption" color={colors.textFaint}>
                {Math.round(progress * 100)}%
              </AppText>
            </View>
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  sessionRow: { flexDirection: 'row', alignItems: 'center' },
  twoColumn: { flexDirection: 'row', gap: spacing.md },
  levelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  levelBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

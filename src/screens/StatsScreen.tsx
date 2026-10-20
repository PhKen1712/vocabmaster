import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText, Card, EmptyState, PrimaryButton, Screen, SectionHeader, StatTile } from '../components/ui';
import { ProgressRow, ScreenHeader, TrackSwitcher } from '../components/patterns';
import { getAccuracy, getActivity, getStreak, getTrackProgress } from '../db/activity';
import { getCounts, getLevelBreakdown, getWeakWords } from '../db/words';
import { lastNDays } from '../lib/date';
import { displayTerm } from '../lib/text';
import { useNavigation } from '../navigation/NavigationProvider';
import { useApp } from '../state/AppProvider';
import { useTheme } from '../theme/ThemeProvider';
import { spacing } from '../theme/tokens';
import { LEVEL_SHORT, type DailyActivity, type Level, type Word } from '../types';

interface StatsData {
  streak: number;
  best: number;
  accuracy: number;
  learned: number;
  total: number;
  activity: DailyActivity[];
  levels: { level: number; total: number; learned: number }[];
  counts: { fresh: number; learning: number; review: number; known: number; due: number };
  weak: { word: Word; wrongCount: number }[];
}

export function StatsScreen() {
  const { db, settings, updateSettings, dataVersion, ready } = useApp();
  const { push } = useNavigation();
  const { colors } = useTheme();
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!db) return;
    setLoading(true);
    try {
      const [streak, accuracy, progress, activity, levels, counts, weak] = await Promise.all([
        getStreak(db),
        getAccuracy(db, 7),
        getTrackProgress(db, settings.track),
        getActivity(db, 21),
        getLevelBreakdown(db, settings.track),
        getCounts(db, settings.track),
        getWeakWords(db, settings.track, 8),
      ]);
      setData({
        streak: streak.current,
        best: streak.best,
        accuracy: accuracy.ratio,
        learned: progress.learned,
        total: progress.total,
        activity,
        levels,
        counts,
        weak,
      });
    } finally {
      setLoading(false);
    }
  }, [db, settings.track]);

  useEffect(() => {
    void load();
  }, [load, dataVersion]);

  if (!ready || loading) {
    return (
      <Screen scroll={false}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  const byDate = new Map((data?.activity ?? []).map((day) => [day.date, day]));
  const days = lastNDays(14).map((key) => byDate.get(key) ?? null);
  const maxAnswered = Math.max(1, ...days.map((day) => day?.answered ?? 0));
  const learned = data?.learned ?? 0;
  const total = data?.total ?? 0;

  return (
    <Screen>
      <ScreenHeader title="Tiến độ" subtitle="Dữ liệu thật từ lịch sử học của bạn" />
      <TrackSwitcher
        value={settings.track}
        onChange={(track) => void updateSettings({ track })}
      />

      <View style={styles.tiles}>
        <StatTile label="Chuỗi ngày" value={data?.streak ?? 0} hint="hiện tại" tone={colors.warning} />
        <StatTile label="Kỷ lục" value={data?.best ?? 0} hint="ngày liên tiếp" />
      </View>
      <View style={[styles.tiles, { marginTop: spacing.md }]}>
        <StatTile
          label="Đã học"
          value={`${learned}/${total}`}
          hint="từ đã ôn ít nhất 1 lần"
        />
        <StatTile
          label="Chính xác 7 ngày"
          value={`${Math.round((data?.accuracy ?? 0) * 100)}%`}
          hint="trên tổng câu đã trả lời"
          tone={colors.accent}
        />
      </View>

      <SectionHeader title="Hoạt động 14 ngày" />
      <Card>
        <View style={styles.chart}>
          {days.map((day, index) => {
            const answered = day?.answered ?? 0;
            const height = Math.max(4, (answered / maxAnswered) * 110);
            const goalMet = day?.goalMet ?? false;
            return (
              <View key={index} style={styles.barColumn}>
                <View
                  style={[
                    styles.bar,
                    {
                      height,
                      backgroundColor: answered === 0
                        ? colors.surfaceAlt
                        : goalMet
                          ? colors.accent
                          : colors.primary,
                    },
                  ]}
                />
                <AppText variant="micro" color={colors.textFaint}>
                  {answered}
                </AppText>
              </View>
            );
          })}
        </View>
        <View style={styles.legend}>
          <AppText variant="caption" color={colors.textMuted}>
            Cột cao = số câu trả lời. Màu xanh = ngày đạt mục tiêu.
          </AppText>
        </View>
      </Card>

      <SectionHeader title="Theo cấp độ" />
      <Card>
        {([0, 1, 2, 3, 4, 5, 6] as Level[]).map((level) => {
          const row = data?.levels.find((item) => item.level === level);
          return (
            <ProgressRow
              key={level}
              label={`${LEVEL_SHORT[level]} · ${row?.total ?? 0} từ`}
              value={row?.learned ?? 0}
              total={Math.max(1, row?.total ?? 0)}
              tone={level === settings.level ? colors.primary : colors.textFaint}
            />
          );
        })}
      </Card>

      <SectionHeader title="Trạng thái ghi nhớ" />
      <Card>
        <ProgressRow label="Chưa học" value={data?.counts.fresh ?? 0} total={Math.max(1, total)} />
        <ProgressRow
          label="Đang học / học lại"
          value={data?.counts.learning ?? 0}
          total={Math.max(1, total)}
          tone={colors.warning}
        />
        <ProgressRow
          label="Đang ôn"
          value={data?.counts.review ?? 0}
          total={Math.max(1, total)}
          tone={colors.accent}
        />
        <ProgressRow
          label="Đã nhớ"
          value={data?.counts.known ?? 0}
          total={Math.max(1, total)}
          tone={colors.success}
        />
        <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.sm }}>
          {data?.counts.due ?? 0} từ đang đến hạn ôn.
        </AppText>
      </Card>

      <SectionHeader title="Từ hay sai" />
      {data && data.weak.length > 0 ? (
        <>
          {data.weak.map(({ word, wrongCount }) => (
            <Card
              key={word.id}
              style={{ marginBottom: spacing.sm }}
              onPress={() => push({ name: 'word', id: word.id })}
            >
              <View style={styles.weakRow}>
                <View style={{ flex: 1 }}>
                  <AppText variant="bodyStrong">{displayTerm(word.term)}</AppText>
                  <AppText variant="caption" color={colors.textMuted}>
                    {word.meaningVi}
                  </AppText>
                </View>
                <AppText variant="caption" color={colors.danger}>
                  sai {wrongCount} lần
                </AppText>
              </View>
            </Card>
          ))}
          <PrimaryButton
            label="Luyện từ hay sai"
            variant="secondary"
            onPress={() =>
              push({ name: 'session', config: { mode: 'weak', track: settings.track } })
            }
          />
        </>
      ) : (
        <EmptyState
          emoji="🌱"
          title="Chưa đủ dữ liệu"
          body="Làm vài buổi học để ứng dụng tổng hợp những từ bạn hay quên."
          actionLabel="Bắt đầu học"
          onAction={() =>
            push({
              name: 'session',
              config: { mode: 'mixed', track: settings.track, level: settings.level },
            })
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tiles: { flexDirection: 'row', gap: spacing.md },
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 150,
    gap: 3,
  },
  barColumn: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  bar: { width: '80%', borderRadius: 4, minHeight: 4 },
  legend: { marginTop: spacing.md },
  weakRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});

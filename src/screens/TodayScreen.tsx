import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { providerLabel } from '../ai/provider';
import { getCoinSummary, type CoinSummary } from '../coins/ledger';
import { getActivityForDate, getStreak } from '../db/activity';
import { completeStreakRestore, getRestoreState, type RestoreState } from '../db/streakRestore';
import { getCounts, getWeakWords, getWordOfTheDay } from '../db/words';
import { dateKey, formatRelativeDue } from '../lib/date';
import { displayTerm } from '../lib/text';
import { useNavigation } from '../navigation/NavigationProvider';
import { speak } from '../speech/tts';
import { useApp } from '../state/AppProvider';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/tokens';
import { LEVEL_SHORT, TRACK_LABELS, type Word } from '../types';
import { AppText, Card, PrimaryButton, ProgressBar, Screen, SectionHeader } from '../components/ui';
import { ScreenHeader, TrackSwitcher } from '../components/patterns';

interface TodayData {
  due: number;
  fresh: number;
  done: number;
  streak: number;
  word: Word | null;
  weak: { word: Word; wrongCount: number }[];
  coins: CoinSummary;
  restore: RestoreState;
}

export function TodayScreen() {
  const { db, settings, updateSettings, dataVersion, ready, notifyDataChanged } = useApp();
  const { push } = useNavigation();
  const { colors } = useTheme();
  const [data, setData] = useState<TodayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [restoreDismissed, setRestoreDismissed] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const load = useCallback(async () => {
    if (!db) return;
    setLoading(true);
    try {
      const today = dateKey();
      const [counts, activity, streak, word, weak, coins, restore] = await Promise.all([
        getCounts(db, settings.track),
        getActivityForDate(db, today),
        getStreak(db, today),
        getWordOfTheDay(db, settings.track, today),
        getWeakWords(db, settings.track, 3),
        getCoinSummary(db, today),
        getRestoreState(db, settings.dailyGoal, today),
      ]);
      setData({
        due: counts.due,
        fresh: counts.fresh,
        done: activity.newWords + activity.reviews,
        streak: streak.current,
        word,
        weak,
        coins,
        restore,
      });
    } finally {
      setLoading(false);
    }
  }, [db, settings.track]);

  useEffect(() => {
    void load();
  }, [load, dataVersion]);

  const goal = Math.max(1, settings.dailyGoal);
  const done = data?.done ?? 0;
  const streak = data?.streak ?? 0;
  const coins = data?.coins ?? null;
  const restore = restoreDismissed ? null : data?.restore.offer ?? null;

  const confirmRestore = () => {
    if (!restore || !db) return;
    Alert.alert(
      `Khôi phục chuỗi ${restore.lostDays} ngày?`,
      `Bạn đã học đủ ${restore.progressNewWords} từ mới hôm nay, đạt mục tiêu ${restore.targetNewWords}. Sau khi khôi phục, hệ số thưởng xu sẽ về 1,0 và phải tích lại từ đầu.`,
      [
        { text: 'Để sau', style: 'cancel', onPress: () => setRestoreDismissed(true) },
        {
          text: 'Khôi phục',
          onPress: async () => {
            setRestoring(true);
            try {
              const ok = await completeStreakRestore(db, restore);
              await notifyDataChanged();
              await load();
              Alert.alert(
                ok ? 'Đã khôi phục chuỗi' : 'Chưa thể khôi phục',
                ok
                  ? 'Chuỗi ngày học đã được nối lại. Hệ số thưởng xu bắt đầu lại từ 1,0.'
                  : 'Mục tiêu chưa hoàn tất hoặc chuỗi này đã được khôi phục trước đó.',
              );
            } finally {
              setRestoring(false);
            }
          },
        },
      ],
    );
  };

  if (!ready || loading) {
    return (
      <Screen scroll={false} edges>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
          <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.md }}>
            Đang mở bộ từ vựng…
          </AppText>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader
        title="Hôm nay"
        subtitle={`${TRACK_LABELS[settings.track]} · ${LEVEL_SHORT[settings.level]}`}
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Mở cài đặt"
            onPress={() => push({ name: 'settings' })}
            style={[styles.iconButton, { backgroundColor: colors.surfaceAlt }]}
          >
            <AppText variant="bodyStrong">⚙︎</AppText>
          </Pressable>
        }
      />

      <TrackSwitcher
        value={settings.track}
        onChange={(track) => {
          void updateSettings({ track, widgetTrack: track });
        }}
      />

      <Card style={{ marginBottom: spacing.lg }}>
        <View style={styles.goalRow}>
          <View style={{ flex: 1 }}>
            <AppText variant="micro" color={colors.textFaint}>
              MỤC TIÊU HÔM NAY
            </AppText>
            <AppText variant="display" style={{ marginTop: 2 }}>
              {done}
              <AppText variant="headline" color={colors.textMuted}>
                /{goal}
              </AppText>
            </AppText>
            <AppText variant="caption" color={colors.textMuted}>
              lượt học và ôn trong ngày
            </AppText>
          </View>
          <View style={[styles.streakBadge, { backgroundColor: colors.warningSoft }]}>
            <AppText style={{ fontSize: 22 }}>🔥</AppText>
            <AppText variant="headline" color={colors.warning}>
              {streak}
            </AppText>
            <AppText variant="micro" color={colors.warning}>
              NGÀY
            </AppText>
          </View>
        </View>
        <View style={{ marginTop: spacing.md }}>
          <ProgressBar value={done / goal} height={10} />
        </View>
        <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.sm }}>
          {done >= goal
            ? 'Đã đạt mục tiêu hôm nay. Học thêm vẫn được tính vào chuỗi.'
            : `Còn ${goal - done} lượt nữa để hoàn thành mục tiêu.`}
        </AppText>
        <View style={styles.coinLine}>
          <AppText variant="caption" color={colors.warning}>
            🪙 {(coins?.balance ?? 0).toLocaleString('vi-VN')} xu
          </AppText>
          <AppText variant="caption" color={colors.textMuted}>
            Hệ số x{(coins?.multiplier ?? 1).toFixed(1)} · {coins?.validStreakDays ?? 0} ngày hợp lệ
          </AppText>
        </View>
      </Card>

      {restore ? (
        <Card style={{ marginBottom: spacing.lg, borderColor: colors.warning }}>
          <AppText variant="micro" color={colors.warning}>
            CHUỖI BỊ ĐỨT
          </AppText>
          <AppText variant="headline" style={{ marginTop: 2 }}>
            Bạn đã mất chuỗi {restore.lostDays} ngày
          </AppText>
          <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.xs }}>
            Học gấp đôi số từ mới hôm nay để nối lại chuỗi. Chỉ từ mới hợp lệ được tính — ôn lại từ
            cũ không giúp khôi phục.
          </AppText>
          <View style={{ marginTop: spacing.md }}>
            <ProgressBar
              value={restore.progressNewWords / Math.max(1, restore.targetNewWords)}
              height={8}
            />
          </View>
          <AppText variant="caption" color={colors.primary} style={{ marginTop: spacing.xs }}>
            {restore.progressNewWords}/{restore.targetNewWords} từ mới hôm nay
          </AppText>
          <View style={styles.actionRow}>
            <PrimaryButton
              label="Khôi phục streak"
              loading={restoring}
              disabled={!restore.ready}
              onPress={confirmRestore}
              style={{ flex: 1 }}
            />
            <PrimaryButton
              label="Để sau"
              variant="ghost"
              style={{ flex: 1 }}
              onPress={() => setRestoreDismissed(true)}
            />
          </View>
        </Card>
      ) : null}

      <Card soft style={{ marginBottom: spacing.lg }}>
        <View style={styles.statsRow}>
          <View style={{ flex: 1 }}>
            <AppText variant="micro" color={colors.textFaint}>
              CẦN ÔN
            </AppText>
            <AppText variant="title" color={colors.primary}>
              {data?.due ?? 0}
            </AppText>
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="micro" color={colors.textFaint}>
              TỪ MỚI
            </AppText>
            <AppText variant="title" color={colors.accent}>
              {data?.fresh ?? 0}
            </AppText>
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="micro" color={colors.textFaint}>
              TRÌNH ĐỘ
            </AppText>
            <AppText variant="title">{LEVEL_SHORT[settings.level]}</AppText>
          </View>
        </View>
      </Card>

      {(data?.due ?? 0) > 0 ? (
        <Card style={{ marginBottom: spacing.lg, borderColor: colors.warning }}>
          <AppText variant="micro" color={colors.warning}>
            ĐANG CÓ TỪ CẦN ÔN
          </AppText>
          <AppText variant="bodyStrong" style={{ marginTop: 2 }}>
            {data?.due} từ đến hạn — chỉ phiên học từ mới tạm khoá
          </AppText>
          <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.xs }}>
            Bạn vẫn thêm từ, nhập danh sách và dùng AI bình thường; từ mới chỉ chưa được học. Hoàn
            thành ôn tập để mở lại phiên học từ mới.
          </AppText>
        </Card>
      ) : null}

      <PrimaryButton
        label={
          (data?.due ?? 0) > 0
            ? `Ôn ngay · ${data?.due} từ cần ôn`
            : (data?.fresh ?? 0) > 0
              ? `Học ${Math.min(settings.dailyGoal, data?.fresh ?? 0)} từ mới`
              : 'Ôn lại từ đã học'
        }
        icon="▶"
        onPress={() => {
          if ((data?.due ?? 0) > 0) {
            push({ name: 'session', config: { mode: 'review', track: settings.track } });
            return;
          }
          if ((data?.fresh ?? 0) > 0) {
            push({ name: 'learn', track: settings.track, level: settings.level });
            return;
          }
          if ((data?.weak.length ?? 0) > 0) {
            push({ name: 'session', config: { mode: 'weak', track: settings.track } });
            return;
          }
          push({ name: 'session', config: { mode: 'review', track: settings.track } });
        }}
      />

      <View style={styles.actionRow}>
        <PrimaryButton
          label="Ôn tập"
          variant="secondary"
          style={{ flex: 1 }}
          onPress={() =>
            push({ name: 'session', config: { mode: 'review', track: settings.track } })
          }
          disabled={(data?.due ?? 0) === 0}
        />
        <PrimaryButton
          label={(data?.due ?? 0) > 0 ? 'Từ mới · đang khoá' : 'Từ mới'}
          variant="secondary"
          style={{ flex: 1 }}
          onPress={() =>
            push({ name: 'learn', track: settings.track, level: settings.level })
          }
          disabled={(data?.fresh ?? 0) === 0 || (data?.due ?? 0) > 0}
        />
      </View>

      <SectionHeader title="Từ của ngày" />
      {data?.word ? (
        <Card onPress={() => push({ name: 'word', id: data.word!.id })}>
          <View style={styles.wordHeader}>
            <View style={{ flex: 1 }}>
              <AppText variant="headline">{displayTerm(data.word.term)}</AppText>
              {data.word.ipa ? (
                <AppText variant="caption" color={colors.textFaint} style={{ marginTop: 2 }}>
                  {data.word.ipa}
                </AppText>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Nghe phát âm"
              onPress={() => speak(data.word!.term, { accent: settings.ttsAccent })}
              style={[styles.iconButton, { backgroundColor: colors.primarySoft }]}
            >
              <AppText variant="bodyStrong" color={colors.primary}>
                🔊
              </AppText>
            </Pressable>
          </View>
          <AppText variant="body" color={colors.textMuted} style={{ marginTop: spacing.sm }}>
            {data.word.meaningVi}
          </AppText>
          {data.word.exampleEn ? (
            <AppText variant="caption" color={colors.textFaint} style={{ marginTop: spacing.sm }}>
              {data.word.exampleEn}
            </AppText>
          ) : null}
          <View style={styles.wordFooter}>
            <AppText variant="micro" color={colors.textFaint}>
              {data.word.topic ?? TRACK_LABELS[data.word.track]} ·{' '}
              {formatRelativeDue(data.word.dueAt).toUpperCase()}
            </AppText>
            <AppText variant="caption" color={colors.primary}>
              Xem chi tiết →
            </AppText>
          </View>
        </Card>
      ) : null}

      <SectionHeader
        title="Cần chú ý"
        actionLabel={data?.weak.length ? 'Luyện ngay' : undefined}
        onAction={
          data?.weak.length
            ? () => push({ name: 'session', config: { mode: 'weak', track: settings.track } })
            : undefined
        }
      />
      {data?.weak.length ? (
        data.weak.map(({ word, wrongCount }) => (
          <Card
            key={word.id}
            onPress={() => push({ name: 'word', id: word.id })}
            style={{ marginBottom: spacing.sm }}
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
        ))
      ) : (
        <Card soft>
          <AppText variant="body" color={colors.textMuted}>
            Chưa có từ nào bị trả lời sai nhiều lần. Cứ học đều, ứng dụng sẽ tự tổng hợp danh sách
            này.
          </AppText>
        </Card>
      )}

      <SectionHeader title="Thêm từ mới" />
      <View style={styles.actionRow}>
        <PrimaryButton
          label="+  Thêm thủ công"
          variant="ghost"
          style={{ flex: 1 }}
          onPress={() => push({ name: 'wordForm' })}
        />
        <PrimaryButton
          label={`✨ ${providerLabel(settings.aiProvider)} gợi ý`}
          variant="ghost"
          style={{ flex: 1 }}
          onPress={() => push({ name: 'ai' })}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goalRow: { flexDirection: 'row', alignItems: 'center' },
  streakBadge: {
    width: 76,
    height: 76,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statsRow: { flexDirection: 'row' },
  actionRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  wordHeader: { flexDirection: 'row', alignItems: 'flex-start' },
  wordFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  weakRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  coinLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});

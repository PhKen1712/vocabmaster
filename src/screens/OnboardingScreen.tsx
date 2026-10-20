import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Card, PrimaryButton, Screen, SectionHeader } from '../components/ui';
import { LevelPicker, Stepper, TrackSwitcher } from '../components/patterns';
import { useNavigation } from '../navigation/NavigationProvider';
import { useApp } from '../state/AppProvider';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/tokens';
import { LEVEL_LABELS, type Level, type Track } from '../types';

export function OnboardingScreen() {
  const { settings, updateSettings, stats } = useApp();
  const { push } = useNavigation();
  const { colors } = useTheme();
  const [track, setTrack] = useState<Track>(settings.track);
  const [level, setLevel] = useState<Level>(settings.level);
  const [dailyGoal, setDailyGoal] = useState(settings.dailyGoal);

  const finish = async () => {
    await updateSettings({
      track,
      widgetTrack: track,
      level,
      dailyGoal,
      onboardingDone: true,
    });
  };

  return (
    <Screen contentStyle={{ paddingTop: spacing.huge }}>
      <View style={styles.brand}>
        <View style={[styles.logo, { backgroundColor: colors.primary }]}>
          <AppText variant="title" color={colors.onPrimary}>
            VM
          </AppText>
        </View>
        <AppText variant="display" style={{ marginTop: spacing.lg }}>
          VocabMaster
        </AppText>
        <AppText
          variant="body"
          color={colors.textMuted}
          style={{ marginTop: spacing.sm, textAlign: 'center' }}
        >
          Học từ vựng tiếng Anh theo lộ trình của riêng bạn, với General English và IELTS tách
          riêng, ôn tập theo lịch khoa học và widget ngay trên iPhone.
        </AppText>
      </View>

      <SectionHeader title="Chọn hệ thống học" />
      <TrackSwitcher value={track} onChange={setTrack} />
      <AppText variant="caption" color={colors.textMuted}>
        {track === 'general'
          ? 'General English: giao tiếp hằng ngày, công việc, du lịch, cảm xúc, cụm từ tự nhiên.'
          : 'IELTS: từ học thuật, collocations, paraphrase và ví dụ theo ngữ cảnh học thuật.'}
      </AppText>

      <SectionHeader title="Bạn đang ở đâu?" />
      <Card>
        <AppText variant="bodyStrong">{LEVEL_LABELS[level]}</AppText>
        <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.xs }}>
          Chọn mức thoải mái nhất. Bạn có thể đổi bất cứ lúc nào trong màn hình Học.
        </AppText>
        <View style={{ marginTop: spacing.md }}>
          <LevelPicker value={level} onChange={setLevel} />
        </View>
        <PrimaryButton
          label="Không chắc? Kiểm tra đầu vào 6 câu"
          variant="ghost"
          onPress={() => push({ name: 'placement' })}
          style={{ marginTop: spacing.md }}
        />
      </Card>

      <SectionHeader title="Mục tiêu mỗi ngày" />
      <Card>
        <Stepper
          label="Số lượt học và ôn"
          value={dailyGoal}
          min={3}
          max={50}
          step={1}
          suffix="lượt"
          onChange={setDailyGoal}
        />
        <AppText variant="caption" color={colors.textMuted}>
          Đạt mục tiêu mỗi ngày sẽ giữ chuỗi ngày học. Đặt mục tiêu nhỏ và đều tốt hơn mục tiêu
          lớn rồi bỏ dở.
        </AppText>
        <AppText variant="caption" color={colors.textFaint} style={{ marginTop: spacing.sm }}>
          Bộ từ khởi tạo: {stats?.totalCount ?? 0} từ có sẵn để học ngay, không cần mạng.
        </AppText>
      </Card>

      <PrimaryButton label="Bắt đầu học" onPress={() => void finish()} style={{ marginTop: spacing.xl }} />
      <AppText
        variant="caption"
        color={colors.textFaint}
        style={{ marginTop: spacing.md, textAlign: 'center' }}
      >
        Gemini và nhắc nhở là tuỳ chọn. Bạn có thể thêm API key sau trong Cài đặt. Widget chỉ hoạt
        động trên bản build native đã cài vào iPhone, không hoạt động trong Expo Go.
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { alignItems: 'center', marginBottom: spacing.lg },
  logo: {
    width: 76,
    height: 76,
    borderRadius: radius.lg + 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

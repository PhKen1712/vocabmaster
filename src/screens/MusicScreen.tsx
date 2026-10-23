import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Banner, Card, EmptyState, Screen, SectionHeader } from '../components/ui';
import { Input, ScreenHeader } from '../components/patterns';
import { MUSIC_CATALOG, searchMusic, type MusicTrackMeta } from '../music/catalog';
import { useMusic } from '../music/MusicProvider';
import { useNavigation } from '../navigation/NavigationProvider';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/tokens';

function formatLength(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

/** Four bars that dance only while the music is actually playing. */
function Equalizer({ active, color }: { active: boolean; color: string }) {
  const values = useRef(
    [0, 1, 2, 3].map(() => new Animated.Value(0.3)),
  ).current;

  useEffect(() => {
    if (!active) {
      for (const value of values) value.setValue(0.3);
      return;
    }
    const animations = values.map((value, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(value, {
            toValue: 1,
            duration: 360 + index * 80,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: false,
          }),
          Animated.timing(value, {
            toValue: 0.28 + index * 0.04,
            duration: 300 + index * 60,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: false,
          }),
        ]),
      ),
    );
    for (const animation of animations) animation.start();
    return () => {
      for (const animation of animations) animation.stop();
    };
  }, [active, values]);

  return (
    <View style={styles.equalizer} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {values.map((value, index) => (
        <Animated.View
          key={index}
          style={{
            width: 3.5,
            borderRadius: 2,
            backgroundColor: color,
            opacity: active ? 1 : 0.35,
            height: value.interpolate({ inputRange: [0.2, 1], outputRange: [5, 22] }),
          }}
        />
      ))}
    </View>
  );
}

function VolumeSlider({
  value,
  muted,
  onChange,
}: {
  value: number;
  muted: boolean;
  onChange: (value: number) => void;
}) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const shown = muted ? 0 : value;

  const jump = (ratio: number) => {
    onChange(Math.max(0, Math.min(1, ratio)));
  };

  return (
    <View style={styles.sliderRow}>
      <Pressable
        accessibilityRole="adjustable"
        accessibilityLabel="Âm lượng nhạc nền"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(shown * 100) }}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        onPress={(event) => {
          if (width > 0) jump(event.nativeEvent.locationX / width);
        }}
        hitSlop={10}
        style={styles.sliderTouch}
      >
        <View style={[styles.sliderTrack, { backgroundColor: colors.border }]}>
          <View
            style={[
              styles.sliderFill,
              { width: `${shown * 100}%`, backgroundColor: colors.primary },
            ]}
          />
        </View>
      </Pressable>
      <AppText variant="caption" color={colors.textMuted} style={styles.volumeLabel}>
        {Math.round(shown * 100)}%
      </AppText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Giảm âm lượng"
        onPress={() => jump(shown - 0.1)}
        hitSlop={8}
        style={[styles.stepButton, { borderColor: colors.border }]}
      >
        <AppText variant="bodyStrong" color={colors.textMuted}>
          −
        </AppText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Tăng âm lượng"
        onPress={() => jump(shown + 0.1)}
        hitSlop={8}
        style={[styles.stepButton, { borderColor: colors.border }]}
      >
        <AppText variant="bodyStrong" color={colors.textMuted}>
          +
        </AppText>
      </Pressable>
    </View>
  );
}

export function MusicScreen() {
  const { pop } = useNavigation();
  const { colors } = useTheme();
  const music = useMusic();
  const [query, setQuery] = useState('');
  const [mood, setMood] = useState<string | null>(null);

  const moods = useMemo(
    () => [...new Set(MUSIC_CATALOG.map((track) => track.mood))],
    [],
  );
  const results = useMemo(
    () => searchMusic(query).filter((track) => !mood || track.mood === mood),
    [query, mood],
  );

  const play = (track: MusicTrackMeta) => {
    if (track.id === music.track.id) {
      music.setEnabled(true);
      return;
    }
    music.selectTrack(track.id);
  };

  return (
    <Screen>
      <ScreenHeader
        title="Nhạc nền"
        subtitle="Chọn nhịp cho việc học của bạn"
        onBack={pop}
      />

      {music.error ? <Banner tone="warning" title="Nhạc chưa phát được" body={music.error} /> : null}

      <Card
        style={{
          backgroundColor: colors.primarySoft,
          borderColor: `${colors.primary}33`,
        }}
      >
        <View style={styles.nowRow}>
          <View style={styles.nowLeft}>
            <Equalizer active={music.enabled && !music.muted} color={colors.primary} />
            <AppText variant="micro" color={colors.primary}>
              {music.enabled ? (music.muted ? 'ĐANG TẮT TIẾNG' : 'ĐANG PHÁT') : 'ĐANG TẠM DỪNG'}
            </AppText>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={music.muted ? 'Bỏ tắt tiếng' : 'Tắt tiếng'}
            onPress={music.toggleMute}
            hitSlop={10}
            style={[styles.muteButton, { backgroundColor: colors.surface }]}
          >
            <AppText style={{ fontSize: 17 }}>{music.muted ? '🔇' : '🔊'}</AppText>
          </Pressable>
        </View>

        <AppText variant="title" style={{ marginTop: spacing.sm }}>
          {music.track.name}
        </AppText>
        <AppText variant="caption" color={colors.textMuted} style={{ marginTop: 2 }}>
          {music.track.nameEn} · {music.track.mood} · {music.track.bpm} BPM ·{' '}
          {formatLength(music.track.seconds)} · lặp liên tục
        </AppText>
        <AppText variant="body" color={colors.textMuted} style={{ marginTop: spacing.sm }}>
          {music.track.description}
        </AppText>

        <View style={styles.playRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={music.enabled ? 'Tạm dừng nhạc' : 'Phát nhạc'}
            onPress={music.togglePlay}
            style={[styles.playButton, { backgroundColor: colors.primary }]}
          >
            <AppText variant="headline" color={colors.onPrimary}>
              {music.enabled ? '❚❚' : '▶'}
            </AppText>
          </Pressable>
          <View style={{ flex: 1 }}>
            <VolumeSlider
              value={music.volume}
              muted={music.muted}
              onChange={music.setVolume}
            />
            <AppText variant="caption" color={colors.textFaint} style={{ marginTop: spacing.xs }}>
              {music.muted
                ? 'Đang tắt tiếng — bấm biểu tượng loa để nghe lại.'
                : music.volume === 0
                  ? 'Âm lượng đang bằng 0.'
                  : 'Chạm vào thanh để đặt âm lượng, hoặc dùng − / +.'}
            </AppText>
          </View>
        </View>
      </Card>

      <SectionHeader title="Thư viện nhạc" />
      <Input
        value={query}
        onChangeText={setQuery}
        placeholder="Tìm: lofi, đêm, tập trung, game…"
        autoCapitalize="none"
      />

      <View style={styles.chipRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: mood === null }}
          onPress={() => setMood(null)}
          style={[
            styles.filterChip,
            {
              borderColor: mood === null ? colors.primary : colors.border,
              backgroundColor: mood === null ? colors.primarySoft : 'transparent',
            },
          ]}
        >
          <AppText variant="caption" color={mood === null ? colors.primary : colors.textMuted}>
            Tất cả
          </AppText>
        </Pressable>
        {moods.map((item) => {
          const active = mood === item;
          return (
            <Pressable
              key={item}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setMood(active ? null : item)}
              style={[
                styles.filterChip,
                {
                  borderColor: active ? colors.primary : colors.border,
                  backgroundColor: active ? colors.primarySoft : 'transparent',
                },
              ]}
            >
              <AppText variant="caption" color={active ? colors.primary : colors.textMuted}>
                {item}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      <AppText variant="caption" color={colors.textFaint} style={{ marginTop: spacing.sm }}>
        {results.length} bản · lưu sẵn trong app, không cần mạng
      </AppText>

      {results.length === 0 ? (
        <EmptyState
          emoji="🎧"
          title="Không tìm thấy bản nhạc nào"
          body="Thử một từ khác — ví dụ “dem”, “focus”, “chill” hoặc bỏ bộ lọc tâm trạng."
          actionLabel="Xoá bộ lọc"
          onAction={() => {
            setQuery('');
            setMood(null);
          }}
        />
      ) : (
        <View style={{ marginTop: spacing.md }}>
          {results.map((track) => {
            const active = track.id === music.track.id;
            return (
              <Card
                key={track.id}
                onPress={() => play(track)}
                style={[
                  styles.trackCard,
                  active && {
                    borderColor: colors.primary,
                    backgroundColor: colors.surfaceAlt,
                  },
                ]}
                accessibilityLabel={`Chọn nhạc ${track.name}`}
              >
                <View style={styles.trackRow}>
                  <View
                    style={[
                      styles.trackIcon,
                      { backgroundColor: active ? colors.primary : colors.surfaceAlt },
                    ]}
                  >
                    {active ? (
                      <Equalizer active={music.enabled && !music.muted} color={colors.onPrimary} />
                    ) : (
                      <AppText variant="bodyStrong" color={colors.textMuted}>
                        ♪
                      </AppText>
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.trackTitleRow}>
                      <AppText variant="bodyStrong" style={{ flexShrink: 1 }} numberOfLines={1}>
                        {track.name}
                      </AppText>
                      {active ? (
                        <AppText variant="micro" color={colors.primary}>
                          ĐANG CHỌN
                        </AppText>
                      ) : null}
                    </View>
                    <AppText variant="caption" color={colors.textMuted} numberOfLines={2}>
                      {track.description}
                    </AppText>
                    <AppText variant="micro" color={colors.textFaint} style={{ marginTop: spacing.xs }}>
                      {track.mood.toUpperCase()} · {track.bpm} BPM · {formatLength(track.seconds)}
                    </AppText>
                  </View>
                </View>
              </Card>
            );
          })}
        </View>
      )}

      <Card soft style={{ marginTop: spacing.lg }}>
        <AppText variant="bodyStrong">Về bản nhạc này</AppText>
        <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.xs }}>
          Mỗi bản được tổng hợp riêng cho VocabMaster và lặp liền mạch, nên không có quảng cáo,
          không cần tài khoản và không tốn dữ liệu. Nhạc tự dừng khi bạn rời ứng dụng để không
          đốt pin; khi quay lại, bài đang chọn tiếp tục phát.
        </AppText>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  nowRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nowLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  equalizer: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 24 },
  muteButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  playButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sliderTouch: { flex: 1, justifyContent: 'center', minHeight: 32 },
  sliderTrack: { height: 8, borderRadius: 4, overflow: 'hidden' },
  sliderFill: { height: '100%', borderRadius: 4 },
  volumeLabel: { minWidth: 38, textAlign: 'right' },
  stepButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  trackCard: { marginBottom: spacing.sm },
  trackRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  trackIcon: {
    width: 46,
    height: 46,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
});

import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Banner, Card, Screen, SectionHeader } from '../components/ui';
import { ScreenHeader, TrackSwitcher } from '../components/patterns';
import { useGameWords } from '../games/useGameWords';
import { useMusic } from '../music/MusicProvider';
import { useNavigation } from '../navigation/NavigationProvider';
import { useApp } from '../state/AppProvider';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/tokens';
import { TRACK_LABELS } from '../types';

export function ArcadeScreen() {
  const { settings, updateSettings } = useApp();
  const { push } = useNavigation();
  const { colors } = useTheme();
  const { pool, loading } = useGameWords(settings.track);
  const music = useMusic();

  const meaningCount = useMemo(
    () => new Set(pool.map((word) => word.meaningVi)).size,
    [pool],
  );
  const rushReady = pool.length >= 4 && meaningCount >= 4;

  const games = [
    {
      key: 'asteroid' as const,
      emoji: '🚀',
      title: 'Bắn thiên thạch',
      tag: 'Gõ từ',
      description:
        'Đọc nghĩa tiếng Việt trên thiên thạch rồi gõ đúng từ tiếng Anh để bắn nổ trước khi nó chạm đáy.',
      best: settings.bestAsteroid,
      tint: colors.primarySoft,
      accent: colors.primary,
      ready: pool.length > 0,
    },
    {
      key: 'rush' as const,
      emoji: '⚡',
      title: '60 giây',
      tag: 'Chọn nghĩa',
      description:
        'Một từ tiếng Anh, bốn nghĩa tiếng Việt, 60 giây. Trả lời đúng để cộng giờ và giữ chuỗi điểm.',
      best: settings.bestRush,
      tint: colors.warningSoft,
      accent: colors.warning,
      ready: rushReady,
    },
    {
      key: 'memory' as const,
      emoji: '🃏',
      title: 'Cặp đôi từ vựng',
      tag: 'Ghi nhớ',
      description:
        'Lật thẻ tìm cặp từ tiếng Anh và nghĩa tiếng Việt. Nhớ vị trí thẻ để ghép với ít lượt nhất.',
      best: settings.bestMemory,
      tint: colors.accentSoft,
      accent: colors.accent,
      ready: pool.length > 0,
    },
  ];

  return (
    <Screen>
      <ScreenHeader
        title="Chơi"
        subtitle="Học mà chơi — dùng chính bộ từ của bạn"
      />

      <TrackSwitcher value={settings.track} onChange={(track) => void updateSettings({ track })} />

      <Card
        style={{
          backgroundColor: colors.primarySoft,
          borderColor: `${colors.primary}33`,
          marginBottom: spacing.md,
        }}
      >
        <View style={styles.heroRow}>
          <View style={{ flex: 1 }}>
            <AppText variant="micro" color={colors.primary}>
              SẴN SÀNG
            </AppText>
            <AppText variant="title" style={{ marginTop: 2 }}>
              {loading ? '…' : `${pool.length} từ`}
            </AppText>
            <AppText variant="caption" color={colors.textMuted}>
              {TRACK_LABELS[settings.track]} · ba chế độ chơi, cùng một bộ từ
            </AppText>
          </View>
          <AppText style={{ fontSize: 42 }}>🎮</AppText>
        </View>
        <View style={styles.chipRow}>
          {['Dùng từ của bạn', 'Không cần mạng', 'Có nhạc nền'].map((label) => (
            <View
              key={label}
              style={[styles.chip, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <AppText variant="micro" color={colors.textMuted}>
                {label}
              </AppText>
            </View>
          ))}
        </View>
      </Card>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : !rushReady ? (
        <Banner
          tone={pool.length > 0 ? 'info' : 'warning'}
          title={pool.length === 0 ? 'Bộ từ đang trống' : 'Chưa đủ từ cho chế độ 60 giây'}
          body={
            pool.length === 0
              ? 'Thêm từ mới (hoặc nhập danh sách) rồi quay lại. Cả ba game đều dùng từ bạn đang học.'
              : 'Chế độ 60 giây cần ít nhất 4 từ có nghĩa khác nhau để tạo đáp án nhiễu. Hai game còn lại vẫn chơi được ngay.'
          }
        />
      ) : null}

      <SectionHeader title="Chọn trò chơi" />
      {games.map((game) => (
        <Card
          key={game.key}
          onPress={() => push({ name: 'game', game: game.key })}
          accessibilityLabel={`Chơi ${game.title}`}
          style={{ marginBottom: spacing.md }}
        >
          <View style={styles.gameRow}>
            <View style={[styles.gameIcon, { backgroundColor: game.tint }]}>
              <AppText style={{ fontSize: 26 }}>{game.emoji}</AppText>
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.titleRow}>
                <AppText variant="headline" style={{ flexShrink: 1 }}>
                  {game.title}
                </AppText>
                <View style={[styles.tag, { backgroundColor: game.tint }]}>
                  <AppText variant="micro" color={game.accent}>
                    {game.tag}
                  </AppText>
                </View>
              </View>
              <AppText
                variant="caption"
                color={colors.textMuted}
                style={{ marginTop: spacing.xs }}
              >
                {game.description}
              </AppText>
              <View style={styles.metaRow}>
                <AppText variant="micro" color={colors.textFaint}>
                  KỶ LỤC {game.best}
                </AppText>
                {!game.ready ? (
                  <AppText variant="micro" color={colors.warning}>
                    CẦN THÊM TỪ
                  </AppText>
                ) : (
                  <AppText variant="micro" color={game.accent}>
                    CHƠI NGAY →
                  </AppText>
                )}
              </View>
            </View>
          </View>
        </Card>
      ))}

      <SectionHeader title="Nhạc nền" />
      <Card onPress={() => push({ name: 'music' })} accessibilityLabel="Mở thư viện nhạc nền">
        <View style={styles.musicRow}>
          <View
            style={[
              styles.musicIcon,
              { backgroundColor: music.enabled ? colors.primarySoft : colors.surfaceAlt },
            ]}
          >
            <AppText style={{ fontSize: 20 }}>{music.muted ? '🔇' : '♪'}</AppText>
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="bodyStrong">
              {music.enabled ? music.track.name : 'Nhạc đang tạm dừng'}
            </AppText>
            <AppText variant="caption" color={colors.textMuted}>
              {music.enabled
                ? `${music.track.mood} · âm lượng ${Math.round(music.volume * 100)}%`
                : 'Bấm để chọn nhạc và bật lại'}
            </AppText>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={music.muted ? 'Bỏ tắt tiếng' : 'Tắt tiếng'}
            onPress={music.toggleMute}
            hitSlop={10}
            style={[styles.muteButton, { backgroundColor: colors.surfaceAlt }]}
          >
            <AppText style={{ fontSize: 16 }}>{music.muted ? '🔇' : '🔊'}</AppText>
          </Pressable>
        </View>
      </Card>

      <AppText variant="caption" color={colors.textFaint} style={{ marginTop: spacing.md }}>
        Điểm được tính từ độ chính xác và tốc độ, lưu riêng cho từng chế độ. Đổi track General /
        IELTS sẽ đổi luôn bộ từ dùng trong game.
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.md },
  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  loading: { paddingVertical: spacing.huge, alignItems: 'center' },
  gameRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  gameIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  tag: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    gap: spacing.md,
  },
  musicRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  musicIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  muteButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

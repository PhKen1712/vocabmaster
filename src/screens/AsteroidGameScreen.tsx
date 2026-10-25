import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';

import { GameFrame, GameOverlay, HudPill } from '../components/GameShell';
import { AppText, PrimaryButton } from '../components/ui';
import {
  createAsteroidGame,
  spawnAsteroid,
  startAsteroidGame,
  tickAsteroid,
  typeAsteroid,
  type Asteroid,
  type AsteroidState,
} from '../games/asteroid';
import { useGamePause } from '../games/useGamePause';
import { useGameWords } from '../games/useGameWords';
import { normalizeTerm } from '../lib/text';
import { useNavigation } from '../navigation/NavigationProvider';
import { useApp } from '../state/AppProvider';
import { playSfx } from '../sound/sfx';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/tokens';
import { TRACK_LABELS } from '../types';

const TICK_MS = 60;

export function AsteroidGameScreen() {
  const { settings, updateSettings } = useApp();
  const { pop, push } = useNavigation();
  const { colors } = useTheme();
  const { pool, loading } = useGameWords(settings.track);

  const [game, setGame] = useState<AsteroidState>(createAsteroidGame);
  const gameRef = useRef(game);
  gameRef.current = game;
  const { paused, toggle: togglePause, resume, pause } = useGamePause(game.status === 'playing');

  const [area, setArea] = useState({ width: 0, height: 0 });
  const [bursts, setBursts] = useState<{ key: string; x: number; y: number }[]>([]);
  const inputRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const flash = useRef(new Animated.Value(0)).current;

  const commit = useCallback((next: AsteroidState) => {
    gameRef.current = next;
    setGame(next);
  }, []);

  const runFlash = useCallback(() => {
    flash.setValue(0);
    Animated.sequence([
      Animated.timing(flash, { toValue: 1, duration: 80, useNativeDriver: true }),
      Animated.timing(flash, { toValue: 0, duration: 340, useNativeDriver: true }),
    ]).start();
  }, [flash]);

  const addBurst = useCallback((asteroid: Asteroid) => {
    setBursts((previous) => [
      ...previous.slice(-4),
      { key: `${asteroid.id}:${Date.now()}`, x: asteroid.x, y: asteroid.y },
    ]);
  }, []);

  useEffect(() => {
    if (bursts.length === 0) return;
    const timer = setTimeout(() => setBursts((previous) => previous.slice(1)), 520);
    return () => clearTimeout(timer);
  }, [bursts]);

  const start = useCallback(() => {
    if (pool.length === 0) return;
    const fresh = spawnAsteroid(startAsteroidGame(createAsteroidGame()), pool);
    commit(fresh);
    setBursts([]);
    resume();
    flash.setValue(0);
    setTimeout(() => inputRef.current?.focus(), 180);
  }, [pool, commit, flash]);

  // The clock ticks in one interval and updates a ref first, so a slow render
  // never delays the fall or double-counts a miss.
  useEffect(() => {
    if (game.status !== 'playing' || paused) return;
    const timer = setInterval(() => {
      const current = gameRef.current;
      if (current.status !== 'playing') return;
      const next = tickAsteroid(current, TICK_MS, pool);
      gameRef.current = next;
      setGame(next);
      if (next.missed > current.missed) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        runFlash();
      }
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [game.status, paused, pool, runFlash]);

  useEffect(() => {
    if (game.status !== 'over') return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    inputRef.current?.blur();
    if (game.score > settings.bestAsteroid) {
      void updateSettings({ bestAsteroid: game.score });
    }
  }, [game.status]);

  const handleChange = (text: string) => {
    const current = gameRef.current;
    if (current.status !== 'playing') return;

    // Backspace without destroying anything: keep the rest of the prefix.
    if (current.typed.startsWith(text)) {
      commit({ ...current, typed: text });
      return;
    }

    const result = typeAsteroid(current, text);
    commit(result.state);

    if (result.destroyed) {
      addBurst(result.destroyed);
      playSfx('hit');
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else if (result.wrong) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      runFlash();
    }
  };

  const stars = useMemo(
    () =>
      Array.from({ length: 30 }, (_, index) => ({
        left: `${(index * 37 + 11) % 100}%`,
        top: `${(index * 53 + 7) % 100}%`,
        size: index % 4 === 0 ? 2.5 : 1.5,
        opacity: 0.25 + (index % 5) * 0.12,
      })),
    [],
  );

  const cardWidth = Math.max(150, Math.min(236, area.width * 0.64));
  const travel = Math.max(1, area.height - 74);

  return (
    <GameFrame
      title="Bắn thiên thạch"
      subtitle={`${pool.length} từ · ${TRACK_LABELS[settings.track]}`}
      right={
        <HudPill
          label="Kỷ lục"
          value={Math.max(settings.bestAsteroid, game.score)}
          tone={colors.warning}
        />
      }
    >
      <View style={styles.flex}>
        <View style={styles.hud}>
          <HudPill label="Điểm" value={game.score} tone={colors.accent} />
          <HudPill label="Chuỗi" value={`×${game.combo}`} tone={colors.primary} />
          <HudPill label="Khiên" value={'♥'.repeat(game.lives) || '—'} tone={colors.danger} />
          {game.status === 'playing' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={paused ? 'Tiếp tục game' : 'Tạm dừng game'}
              onPress={togglePause}
              hitSlop={8}
              style={[styles.pauseButton, { backgroundColor: colors.surfaceAlt }]}
            >
              <AppText variant="bodyStrong">{paused ? '▶' : '⏸'}</AppText>
            </Pressable>
          ) : null}
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
            <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.md }}>
              Đang chuẩn bị từ vựng…
            </AppText>
          </View>
        ) : (
          <View
            style={styles.arena}
            onLayout={(event) =>
              setArea({
                width: event.nativeEvent.layout.width,
                height: event.nativeEvent.layout.height,
              })
            }
          >
            <View
              pointerEvents="none"
              style={[
                styles.glow,
                { backgroundColor: colors.primary, top: -90, right: -70 },
              ]}
            />
            <View
              pointerEvents="none"
              style={[
                styles.glow,
                { backgroundColor: colors.accent, bottom: -80, left: -90, width: 200, height: 200 },
              ]}
            />
            {stars.map((star, index) => (
              <View
                key={index}
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: star.left as `${number}%`,
                  top: star.top as `${number}%`,
                  width: star.size,
                  height: star.size,
                  borderRadius: star.size,
                  backgroundColor: colors.text,
                  opacity: star.opacity,
                }}
              />
            ))}

            {game.asteroids.map((asteroid) => {
              const typed = game.typed.trim();
              const isCandidate =
                typed.length > 0 &&
                normalizeTerm(asteroid.term).startsWith(normalizeTerm(typed));
              return (
                <View
                  key={asteroid.id}
                  pointerEvents="none"
                  style={[
                    styles.asteroid,
                    {
                      left: asteroid.x * Math.max(0, area.width - cardWidth),
                      top: asteroid.y * travel,
                      width: cardWidth,
                      backgroundColor: colors.surface,
                      borderColor: isCandidate ? colors.accent : colors.primary,
                    },
                  ]}
                >
                  <MaskedTerm asteroid={asteroid} typed={game.typed} />
                  <AppText variant="caption" color={colors.textMuted} numberOfLines={1}>
                    {asteroid.meaning}
                  </AppText>
                  {asteroid.descriptionEn ? (
                    <AppText variant="micro" color={colors.textFaint} numberOfLines={2}>
                      {asteroid.descriptionEn}
                    </AppText>
                  ) : null}
                </View>
              );
            })}

            {bursts.map((burst) => (
              <Burst
                key={burst.key}
                x={burst.x}
                y={burst.y}
                width={area.width}
                travel={travel}
                cardWidth={cardWidth}
              />
            ))}

            <Animated.View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                {
                  backgroundColor: colors.danger,
                  opacity: flash.interpolate({ inputRange: [0, 1], outputRange: [0, 0.2] }),
                },
              ]}
            />
          </View>
        )}

        <View
          style={[
            styles.inputBar,
            { backgroundColor: colors.surface, borderTopColor: colors.border },
          ]}
        >
          <TextInput
            ref={inputRef}
            value={game.typed}
            onChangeText={handleChange}
            editable={game.status === 'playing' && !paused}
            placeholder={
              game.status === 'playing' ? 'Gõ đủ từ tiếng Anh…' : 'Bấm Bắt đầu để chơi'
            }
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            keyboardAppearance="dark"
            returnKeyType="done"
            blurOnSubmit={false}
            onSubmitEditing={() => inputRef.current?.focus()}
            accessibilityLabel="Ô gõ từ tiếng Anh"
            style={[
              styles.input,
              {
                color: colors.text,
                borderColor: game.typed ? colors.primary : colors.border,
                backgroundColor: colors.surfaceAlt,
              },
            ]}
          />
          <AppText variant="caption" color={colors.textFaint} style={{ marginTop: spacing.sm }}>
            Thiên thạch che vài chữ. Đọc mô tả tiếng Anh và nghĩa tiếng Việt rồi gõ đủ từ — chữ đã gõ đúng sẽ hiện ra.
          </AppText>
        </View>

        {game.status === 'ready' ? (
          <GameOverlay
            emoji="🚀"
            title={pool.length > 0 ? 'Thiên thạch từ vựng' : 'Cần từ để chơi'}
            subtitle={
              pool.length > 0
                ? 'Mỗi thiên thạch che vài chữ cái, hiện mô tả tiếng Anh và nghĩa tiếng Việt. Nhớ lại và gõ đủ từ trước khi nó chạm đáy.'
                : 'Bộ từ của bạn đang trống. Thêm vài từ rồi quay lại — game dùng chính từ bạn đang học.'
            }
            note={
              pool.length > 0
                ? 'Mỗi thiên thạch chạm đáy mất một khiên; bạn có 3 khiên. Gõ đúng liên tiếp để nhân điểm.'
                : undefined
            }
            primaryLabel={pool.length > 0 ? 'Bắt đầu' : 'Thêm từ mới'}
            onPrimary={pool.length > 0 ? start : () => push({ name: 'wordForm' })}
            secondaryLabel="Về sảnh game"
            onSecondary={pop}
          />
        ) : null}

        {paused && game.status === 'playing' ? (
          <GameOverlay
            emoji="⏸"
            title="Đã tạm dừng"
            subtitle="Thiên thạch và đồng hồ đang đứng yên. Ứng dụng tự tạm dừng khi bạn rời màn hình."
            primaryLabel="Tiếp tục"
            onPrimary={resume}
            secondaryLabel="Thoát game"
            onSecondary={pop}
          />
        ) : null}

        {game.status === 'over' ? (
          <GameOverlay
            emoji="💥"
            title="Hết khiên!"
            subtitle="Thiên thạch đã chạm đáy ba lần. Đọc nghĩa trước, gõ sau — chậm mà chắc."
            stats={[
              { label: 'Điểm', value: game.score, tone: colors.accent },
              { label: 'Nổ', value: game.hits },
              { label: 'Chuỗi', value: `×${game.bestCombo}` },
            ]}
            note={`Kỷ lục của bạn: ${Math.max(settings.bestAsteroid, game.score)} điểm.`}
            primaryLabel="Chơi lại"
            onPrimary={start}
            secondaryLabel="Về sảnh game"
            onSecondary={pop}
          />
        ) : null}
      </View>
    </GameFrame>
  );
}

function MaskedTerm({ asteroid, typed }: { asteroid: Asteroid; typed: string }) {
  const { colors } = useTheme();
  const typedNorm = normalizeTerm(typed);
  const chars = [...asteroid.term];
  const hidden = new Set(asteroid.blanked);

  return (
    <AppText variant="bodyStrong" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
      {chars.map((char, index) => {
        const typedHere = index < typedNorm.length && typedNorm[index] === char.toLowerCase();
        const isHidden = hidden.has(index) && !typedHere;
        return (
          <AppText
            key={`${asteroid.id}:${index}`}
            variant="bodyStrong"
            color={typedHere ? colors.accent : colors.text}
          >
            {isHidden ? '_' : char}
          </AppText>
        );
      })}
    </AppText>
  );
}

function Burst({
  x,
  y,
  width,
  travel,
  cardWidth,
}: {
  x: number;
  y: number;
  width: number;
  travel: number;
  cardWidth: number;
}) {
  const { colors } = useTheme();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: 500,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [progress]);

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: x * Math.max(0, width - cardWidth) + cardWidth / 2 - 26,
        top: y * travel + 8,
        width: 52,
        height: 52,
        borderRadius: 26,
        borderWidth: 2,
        borderColor: colors.accent,
        opacity: progress.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 0.8, 0] }),
        transform: [
          {
            scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1.9] }),
          },
        ],
      }}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hud: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  pauseButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 'auto',
  },
  arena: { flex: 1, overflow: 'hidden' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  glow: {
    position: 'absolute',
    width: 240,
    height: 240,
    borderRadius: 120,
    opacity: 0.1,
  },
  asteroid: {
    position: 'absolute',
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 58,
    justifyContent: 'center',
  },
  inputBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  input: {
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 0.4,
  },
});

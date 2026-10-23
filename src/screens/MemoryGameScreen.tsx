import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { GameFrame, GameOverlay, HudPill } from '../components/GameShell';
import { AppText } from '../components/ui';
import {
  createMemory,
  flipMemory,
  memoryAccuracy,
  resolveMemory,
  type MemoryCard,
  type MemoryState,
} from '../games/memory';
import { useGamePause } from '../games/useGamePause';
import { useGameWords } from '../games/useGameWords';
import { useNavigation } from '../navigation/NavigationProvider';
import { useApp } from '../state/AppProvider';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/tokens';
import { TRACK_LABELS } from '../types';

const GAP = 8;

export function MemoryGameScreen() {
  const { settings, updateSettings } = useApp();
  const { pop, push } = useNavigation();
  const { colors } = useTheme();
  const { pool, loading } = useGameWords(settings.track);

  const [game, setGame] = useState<MemoryState>(() => createMemory([], 1));
  const gameRef = useRef(game);
  gameRef.current = game;
  const { paused, toggle: togglePause, resume } = useGamePause(game.status === 'playing');

  const [area, setArea] = useState({ width: 0, height: 0 });
  const resolveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearResolveTimer = () => {
    if (resolveTimer.current) {
      clearTimeout(resolveTimer.current);
      resolveTimer.current = null;
    }
  };

  useEffect(() => () => clearResolveTimer(), []);

  const pairs = Math.min(6, pool.length);
  const score = Math.max(
    0,
    game.totalPairs * 100 - Math.max(0, game.flips - game.totalPairs) * 8,
  );

  const start = useCallback(() => {
    if (pool.length === 0) return;
    clearResolveTimer();
    resume();
    const fresh = createMemory(pool, Math.min(6, pool.length));
    gameRef.current = fresh;
    setGame(fresh);
  }, [pool]);

  useEffect(() => {
    if (game.status !== 'over') return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (score > settings.bestMemory) {
      void updateSettings({ bestMemory: score });
    }
  }, [game.status]);

  const flip = (id: string) => {
    const current = gameRef.current;
    if (current.status !== 'playing' || paused || current.wrongPair) return;

    const next = flipMemory(current, id);
    if (next === current) return;
    gameRef.current = next;
    setGame(next);

    if (next.matchedPairs > current.matchedPairs) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      void Haptics.selectionAsync();
    }

    if (next.wrongPair) {
      clearResolveTimer();
      resolveTimer.current = setTimeout(() => {
        const resolved = resolveMemory(gameRef.current);
        gameRef.current = resolved;
        setGame(resolved);
      }, 850);
    }
  };

  const columns = 3;
  const rows = Math.max(1, Math.ceil(game.cards.length / columns));
  const gridWidth = Math.max(0, area.width - spacing.lg * 2);
  const gridHeight = Math.max(0, area.height - spacing.lg * 2);
  const cardWidth = gridWidth > 0 ? (gridWidth - GAP * (columns - 1)) / columns : 0;
  const cardHeight = gridHeight > 0 ? (gridHeight - GAP * (rows - 1)) / rows : 0;
  const size = Math.max(64, Math.min(cardWidth || 96, cardHeight || 96));

  return (
    <GameFrame
      title="Cặp đôi từ vựng"
      subtitle={`${pairs} cặp · ${TRACK_LABELS[settings.track]}`}
      right={
        <HudPill
          label="Kỷ lục"
          value={Math.max(settings.bestMemory, score)}
          tone={colors.warning}
        />
      }
    >
      <View style={styles.flex}>
        <View style={styles.hud}>
          <HudPill label="Cặp" value={`${game.matchedPairs}/${game.totalPairs}`} tone={colors.accent} />
          <HudPill label="Lượt lật" value={game.flips} tone={colors.primary} />
          <HudPill label="Điểm" value={score} tone={colors.warning} />
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
            {game.cards.length > 0 ? (
              <View
                style={[
                  styles.grid,
                  { maxWidth: size * columns + GAP * (columns - 1) },
                ]}
              >
                {game.cards.map((card) => (
                  <MemoryCard
                    key={card.id}
                    card={card}
                    size={size}
                    faceUp={card.matched || game.open.includes(card.id)}
                    matched={card.matched}
                    wrong={Boolean(game.wrongPair?.includes(card.id))}
                    disabled={game.status !== 'playing' || Boolean(game.wrongPair)}
                    onPress={() => flip(card.id)}
                  />
                ))}
              </View>
            ) : null}
          </View>
        )}

        <View style={styles.footer}>
          <AppText variant="caption" color={colors.textFaint}>
            Lật hai thẻ: một từ tiếng Anh và đúng nghĩa tiếng Việt của nó. Ghép hết bộ thẻ với ít
            lượt lật nhất.
          </AppText>
        </View>

        {paused && game.status === 'playing' ? (
          <GameOverlay
            emoji="⏸"
            title="Đã tạm dừng"
            subtitle="Các thẻ đang đứng yên. Ứng dụng tự tạm dừng khi bạn rời màn hình."
            primaryLabel="Tiếp tục"
            onPrimary={resume}
            secondaryLabel="Thoát game"
            onSecondary={pop}
          />
        ) : null}

        {game.status === 'over' && game.totalPairs > 0 ? (
          <GameOverlay
            emoji="🃏"
            title="Đã ghép xong!"
            subtitle={`Bạn hoàn thành ${game.totalPairs} cặp sau ${game.flips} lượt lật.`}
            stats={[
              { label: 'Điểm', value: score, tone: colors.accent },
              { label: 'Cặp', value: game.matchedPairs, tone: colors.success },
              { label: 'Chính xác', value: `${memoryAccuracy(game)}%` },
            ]}
            note={`Kỷ lục: ${Math.max(settings.bestMemory, score)} điểm. Điểm cao khi bạn ghép đúng ngay từ những lượt đầu.`}
            primaryLabel="Chơi lại"
            onPrimary={start}
            secondaryLabel="Về sảnh game"
            onSecondary={pop}
          />
        ) : null}

        {game.status !== 'playing' && game.totalPairs === 0 ? (
          <GameOverlay
            emoji="🃏"
            title={pool.length > 0 ? 'Cặp đôi từ vựng' : 'Cần từ để chơi'}
            subtitle={
              pool.length > 0
                ? 'Lật thẻ để tìm cặp từ tiếng Anh và nghĩa tiếng Việt. Nhớ vị trí thẻ đã lật để ghép nhanh hơn.'
                : 'Bộ từ của bạn đang trống. Thêm vài từ rồi quay lại — mỗi cặp dùng chính từ bạn đang học.'
            }
            note={
              pool.length > 0
                ? `${pairs} cặp · càng ít lượt lật, điểm càng cao.`
                : undefined
            }
            primaryLabel={pool.length > 0 ? 'Bắt đầu' : 'Thêm từ mới'}
            onPrimary={pool.length > 0 ? start : () => push({ name: 'wordForm' })}
            secondaryLabel="Về sảnh game"
            onSecondary={pop}
          />
        ) : null}
      </View>
    </GameFrame>
  );
}

function MemoryCard({
  card,
  size,
  faceUp,
  matched,
  wrong,
  disabled,
  onPress,
}: {
  card: MemoryCard;
  size: number;
  faceUp: boolean;
  matched: boolean;
  wrong: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();

  const background = matched
    ? colors.successSoft
    : wrong
      ? colors.dangerSoft
      : faceUp
        ? colors.surface
        : colors.surfaceAlt;
  const border = matched ? colors.success : wrong ? colors.danger : faceUp ? colors.primary : colors.border;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        faceUp ? `${card.kind === 'term' ? 'Từ' : 'Nghĩa'}: ${card.text}` : 'Thẻ úp'
      }
      accessibilityState={{ selected: faceUp, disabled }}
      disabled={disabled || faceUp}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          width: size,
          height: size,
          backgroundColor: background,
          borderColor: border,
          opacity: pressed ? 0.85 : 1,
          transform: [{ scale: pressed ? 0.97 : 1 }],
        },
      ]}
    >
      {faceUp ? (
        <View style={styles.cardFace}>
          <AppText variant="micro" color={matched ? colors.success : colors.textFaint}>
            {card.kind === 'term' ? 'TỪ' : 'NGHĨA'}
          </AppText>
          <AppText
            variant={card.kind === 'term' ? 'bodyStrong' : 'caption'}
            color={
              matched
                ? colors.success
                : card.kind === 'term'
                  ? colors.primary
                  : colors.text
            }
            style={styles.cardText}
            numberOfLines={4}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
          >
            {card.text}
          </AppText>
        </View>
      ) : (
        <View style={styles.cardBack}>
          <View style={[styles.backRing, { borderColor: colors.primary }]}>
            <AppText variant="headline" color={colors.primary}>
              ✦
            </AppText>
          </View>
        </View>
      )}
    </Pressable>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  arena: { flex: 1, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, justifyContent: 'center' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GAP,
    alignSelf: 'center',
    justifyContent: 'center',
  },
  card: {
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.sm,
  },
  cardFace: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cardText: { textAlign: 'center', marginTop: 4 },
  cardBack: { alignItems: 'center', justifyContent: 'center' },
  backRing: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.9,
  },
  footer: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
});

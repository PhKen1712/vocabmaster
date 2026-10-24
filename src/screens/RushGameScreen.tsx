import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { GameFrame, GameOverlay, HudPill } from '../components/GameShell';
import { AppText, Card, PrimaryButton, ProgressBar } from '../components/ui';
import {
  answerRush,
  continueRush,
  createRush,
  startRush,
  tickRush,
  type RushState,
} from '../games/rush';
import { useGamePause } from '../games/useGamePause';
import { useGameWords } from '../games/useGameWords';
import { useNavigation } from '../navigation/NavigationProvider';
import { useApp } from '../state/AppProvider';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/tokens';
import { TRACK_LABELS } from '../types';

const TICK_MS = 200;

interface Reveal {
  choice: number;
  correct: boolean;
  questionIndex: number;
}

export function RushGameScreen() {
  const { settings, updateSettings } = useApp();
  const { pop, push } = useNavigation();
  const { colors } = useTheme();
  const { pool, loading } = useGameWords(settings.track);

  const [game, setGame] = useState<RushState>(() => createRush([]));
  const gameRef = useRef(game);
  gameRef.current = game;

  // The rush needs four words whose Vietnamese meanings differ, otherwise the
  // three distractors cannot be built. The arcade gate uses the same rule.
  const canPlay = useMemo(() => {
    const meanings = new Set(pool.map((word) => word.meaningVi.trim()));
    return pool.length >= 4 && meanings.size >= 4;
  }, [pool]);
  const { paused, toggle: togglePause, resume } = useGamePause(game.status === 'playing');

  const [reveal, setReveal] = useState<Reveal | null>(null);
  const revealRef = useRef<Reveal | null>(null);
  revealRef.current = reveal;
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRevealTimer = () => {
    if (revealTimer.current) {
      clearTimeout(revealTimer.current);
      revealTimer.current = null;
    }
  };

  useEffect(() => () => clearRevealTimer(), []);

  const start = useCallback(() => {
    if (!canPlay) return;
    clearRevealTimer();
    setReveal(null);
    revealRef.current = null;
    resume();
    const fresh = startRush(createRush(pool));
    gameRef.current = fresh;
    setGame(fresh);
  }, [pool, canPlay]);

  // `createRush([])` starts in "over" with no questions. Once the learner's
  // words arrive, build the real set so the intro card can appear; without this
  // the screen stayed on a dash with no button to start (the 60-second mode
  // looked broken).
  useEffect(() => {
    if (loading) return;
    if (gameRef.current.status !== 'over' || gameRef.current.questions.length > 0) return;
    const next = createRush(pool);
    gameRef.current = next;
    setGame(next);
  }, [loading, pool]);

  useEffect(() => {
    if (game.status !== 'playing' || paused) return;
    const timer = setInterval(() => {
      const current = gameRef.current;
      if (current.status !== 'playing') return;
      const next = tickRush(current, TICK_MS);
      gameRef.current = next;
      setGame(next);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [game.status, paused]);

  useEffect(() => {
    // Do not buzz when the screen first opens with an empty pool.
    if (game.status !== 'over' || game.questions.length === 0) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    if (game.score > settings.bestRush) {
      void updateSettings({ bestRush: game.score });
    }
  }, [game.status]);

  const answer = (choice: number) => {
    const current = gameRef.current;
    if (current.status !== 'playing' || paused || revealRef.current) return;
    const questionIndex = current.index;
    const question = current.questions[questionIndex];
    if (!question) return;

    const correct = choice === question.answerIndex;
    const answered = answerRush(current, choice);
    // Refill a finished batch while the clock still runs, so a small word
    // collection still gets a full 60 seconds instead of a 5-second round.
    const next = continueRush(answered, pool);
    gameRef.current = next;
    setGame(next);

    const notice: Reveal = { choice, correct, questionIndex };
    revealRef.current = notice;
    setReveal(notice);
    clearRevealTimer();
    revealTimer.current = setTimeout(
      () => {
        revealRef.current = null;
        setReveal(null);
      },
      correct ? 420 : 820,
    );

    if (correct) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } else {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const shownIndex = reveal ? reveal.questionIndex : game.index;
  const question = game.questions[shownIndex] ?? null;
  const finished = game.timeLeftMs > 0 && game.correct + game.wrong > 0;
  const seconds = Math.ceil(game.timeLeftMs / 1000);
  const urgent = game.timeLeftMs <= 10_000;

  return (
    <GameFrame
      title="60 giây"
      subtitle={`${pool.length} từ · ${TRACK_LABELS[settings.track]}`}
      right={
        <HudPill
          label="Kỷ lục"
          value={Math.max(settings.bestRush, game.score)}
          tone={colors.warning}
        />
      }
    >
      <View style={styles.flex}>
        <View style={styles.hud}>
          <HudPill label="Điểm" value={game.score} tone={colors.accent} />
          <HudPill label="Chuỗi" value={`×${game.combo}`} tone={colors.primary} />
          <HudPill label="Còn" value={`${seconds}s`} tone={urgent ? colors.danger : colors.text} />
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
          <View style={styles.body}>
            <View style={{ marginTop: spacing.sm }}>
              <ProgressBar
                value={game.durationMs > 0 ? game.timeLeftMs / game.durationMs : 0}
                height={6}
                tone={urgent ? colors.danger : colors.primary}
              />
            </View>

            <Card style={styles.questionCard}>
              <AppText variant="micro" color={colors.textFaint}>
                CHỌN NGHĨA TIẾNG VIỆT ĐÚNG
              </AppText>
              <AppText
                variant="display"
                style={styles.term}
                numberOfLines={2}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
              >
                {question?.term ?? '—'}
              </AppText>
              <AppText variant="caption" color={colors.textMuted}>
                {reveal
                  ? reveal.correct
                    ? 'Đúng! +1,2 giây'
                    : 'Sai rồi — đáp án đúng đang sáng xanh.'
                  : `Câu ${Math.min(game.index + 1, game.questions.length)}/${game.questions.length}`}
              </AppText>
            </Card>

            <View style={styles.options}>
              {question?.options.map((option, index) => {
                const isAnswer = index === question.answerIndex;
                const picked = reveal?.choice === index;
                const showCorrect = Boolean(reveal) && isAnswer;
                const showWrong = Boolean(reveal) && picked && !isAnswer;
                const background = showCorrect
                  ? colors.successSoft
                  : showWrong
                    ? colors.dangerSoft
                    : colors.surface;
                const border = showCorrect
                  ? colors.success
                  : showWrong
                    ? colors.danger
                    : colors.border;
                const tint = showCorrect
                  ? colors.success
                  : showWrong
                    ? colors.danger
                    : colors.text;

                return (
                  <Pressable
                    key={`${index}:${option}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Đáp án ${option}`}
                    onPress={() => answer(index)}
                    disabled={game.status !== 'playing' || reveal !== null}
                    style={({ pressed }) => [
                      styles.option,
                      {
                        backgroundColor: background,
                        borderColor: border,
                        opacity: pressed ? 0.82 : 1,
                      },
                    ]}
                  >
                    <View style={[styles.letter, { backgroundColor: colors.surfaceAlt }]}>
                      <AppText variant="caption" color={colors.textMuted}>
                        {String.fromCharCode(65 + index)}
                      </AppText>
                    </View>
                    <AppText variant="bodyStrong" color={tint} style={{ flex: 1 }}>
                      {option}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>

            <AppText variant="caption" color={colors.textFaint} style={styles.hint}>
              Đúng: +1,2 giây và tăng chuỗi. Sai: −2,5 giây, chuỗi về 0. Trả lời càng nhanh càng
              nhiều câu.
            </AppText>
          </View>
        )}

        {game.status === 'ready' ||
        (game.status === 'over' && game.questions.length === 0) ? (
          <GameOverlay
            emoji="⚡"
            title={canPlay ? '60 giây' : 'Cần ít nhất 4 từ khác nghĩa'}
            subtitle={
              canPlay
                ? 'Một từ tiếng Anh, bốn nghĩa tiếng Việt, 60 giây. Chọn đúng càng nhanh, chuỗi điểm càng cao.'
                : 'Trò chơi cần ít nhất 4 từ có nghĩa tiếng Việt khác nhau để tạo đáp án nhiễu. Thêm vài từ rồi quay lại nhé.'
            }
            note={
              canPlay
                ? 'Mỗi câu đúng cộng thêm thời gian; trả lời sai chỉ bị trừ giây chứ không kết thúc lượt chơi.'
                : undefined
            }
            primaryLabel={canPlay ? 'Bắt đầu' : 'Thêm từ mới'}
            onPrimary={canPlay ? start : () => push({ name: 'wordForm' })}
            secondaryLabel="Về sảnh game"
            onSecondary={pop}
          />
        ) : null}

        {paused && game.status === 'playing' ? (
          <GameOverlay
            emoji="⏸"
            title="Đã tạm dừng"
            subtitle="Đồng hồ đang đứng yên. Ứng dụng tự tạm dừng khi bạn rời màn hình."
            primaryLabel="Tiếp tục"
            onPrimary={resume}
            secondaryLabel="Thoát game"
            onSecondary={pop}
          />
        ) : null}

        {game.status === 'over' && game.questions.length > 0 ? (
          <GameOverlay
            emoji={finished ? '🏁' : '⏱'}
            title={finished ? 'Hoàn thành bộ câu hỏi!' : 'Hết giờ!'}
            subtitle={
              finished
                ? 'Bạn đã đi hết toàn bộ câu hỏi. Thử lại để phá kỷ lục với bộ từ hiện tại.'
                : 'Thời gian đã hết. Đọc nghĩa kỹ hơn một chút để giữ chuỗi lâu hơn.'
            }
            stats={[
              { label: 'Điểm', value: game.score, tone: colors.accent },
              { label: 'Đúng', value: game.correct, tone: colors.success },
              { label: 'Sai', value: game.wrong, tone: colors.danger },
            ]}
            note={`Chuỗi tốt nhất: ×${game.bestCombo}. Kỷ lục: ${Math.max(settings.bestRush, game.score)} điểm.`}
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
  body: { flex: 1, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  questionCard: {
    marginTop: spacing.md,
    alignItems: 'center',
    paddingVertical: spacing.xxl,
  },
  term: { textAlign: 'center', marginTop: spacing.sm, marginBottom: spacing.sm },
  options: { marginTop: spacing.md, gap: spacing.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 58,
  },
  letter: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: { marginTop: spacing.md },
});

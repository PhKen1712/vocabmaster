import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';

import { AppText, Banner, Card, PrimaryButton, ProgressBar, Screen } from '../components/ui';
import { ScreenHeader } from '../components/patterns';
import { FadeSlideIn, useReduceMotion } from '../components/motion';
import { getNewWords, listWords } from '../db/words';
import { recordReview } from '../db/reviews';
import { newId } from '../lib/ids';
import { useNavigation } from '../navigation/NavigationProvider';
import { generateQuestions } from '../quiz/generator';
import { gradeAnswer, type GradeResult } from '../quiz/grading';
import { describeInterval, schedule, type ScheduleResult } from '../srs/fsrs';
import { speak } from '../speech/tts';
import { useApp } from '../state/AppProvider';
import { getStudyGate } from '../study/gate';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/tokens';
import { LEVEL_SHORT, type Level, type QuizQuestion, type ReviewRating, type Track, type Word } from '../types';

type Stage = 'intro' | 'check' | 'rate' | 'done';

const RATING_LABELS: Record<ReviewRating, string> = {
  1: 'Chưa nhớ',
  2: 'Khó',
  3: 'Tốt',
  4: 'Rất dễ',
};

/**
 * New words go through introduction before any question.
 *
 * For every word the learner sees the meaning, pronunciation and examples,
 * can flip the card for more detail, then answers one check question and rates
 * how well they remember it. Only that final step writes a review, so simply
 * opening the screen cannot be mistaken for having studied. Coins follow the
 * normal first-correct rule; rating a card never creates coins by itself.
 */
export function LearnScreen({ track, level }: { track: Track; level?: Level }) {
  const { db, settings, notifyDataChanged } = useApp();
  const { pop, push } = useNavigation();
  const { colors } = useTheme();
  const reducedMotion = useReduceMotion();

  const [words, setWords] = useState<Word[]>([]);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [stage, setStage] = useState<Stage>('intro');
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [empty, setEmpty] = useState<string | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [answer, setAnswer] = useState<GradeResult | null>(null);
  const [answered, setAnswered] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [sessionCoins, setSessionCoins] = useState(0);
  const [coinNote, setCoinNote] = useState<{ amount: number; reason: string | null } | null>(null);
  const [speechError, setSpeechError] = useState<string | null>(null);

  const flipAnim = useRef(new Animated.Value(1)).current;
  const eventIdRef = useRef<string | null>(null);
  const savingRef = useRef(false);
  const wordStartedAt = useRef(Date.now());

  const word = words[index] ?? null;
  const question = questions[index] ?? null;

  const load = useCallback(async () => {
    if (!db) return;
    setLoading(true);
    setBlocked(null);
    setEmpty(null);
    try {
      const gate = await getStudyGate(db, track);
      if (gate.dueCount > 0) {
        setBlocked(
          `Bạn còn ${gate.dueCount} từ cần ôn. Hoàn thành ôn tập trước khi học từ mới.`,
        );
        setWords([]);
        return;
      }

      const targetLevel = level ?? settings.level;
      const fresh = await getNewWords(
        db,
        track,
        targetLevel,
        Math.min(10, Math.max(3, settings.dailyGoal)),
      );
      if (fresh.length === 0) {
        setEmpty('Bạn đã học hết từ mới ở cấp độ này. Giảm cấp độ hoặc thêm từ mới.');
        setWords([]);
        return;
      }

      const pool = await listWords(db, { track, limit: 400 });
      const learned = pool.filter((item) => item.reps > 0);
      const distractorPool = learned.length >= 2 ? learned : pool;
      const built = fresh.map((item) => {
        const kinds = item.level <= 2 ? (['en_to_vi'] as const) : (['typing'] as const);
        const generated = generateQuestions([item], distractorPool, {
          limit: 1,
          kinds: [...kinds],
        });
        return (
          generated[0] ??
          generateQuestions([item], distractorPool, { limit: 1, kinds: ['typing'] })[0] ??
          null
        );
      });

      setWords(fresh);
      setQuestions(built.filter((item): item is QuizQuestion => item !== null));
      setIndex(0);
      setStage('intro');
      setFlipped(false);
      setSelectedOption(null);
      setTyped('');
      setAnswer(null);
      setAnswered(false);
      setReviewed(0);
      setCorrectCount(0);
      setSessionCoins(0);
      setCoinNote(null);
      eventIdRef.current = null;
      wordStartedAt.current = Date.now();
      flipAnim.setValue(1);
    } finally {
      setLoading(false);
    }
  }, [db, track, level, settings.level, settings.dailyGoal, flipAnim]);

  useEffect(() => {
    void load();
  }, [load]);

  const previews = useMemo(() => {
    if (!word) return [] as { rating: ReviewRating; result: ScheduleResult }[];
    const card = {
      stability: word.stability,
      difficulty: word.difficulty,
      reps: word.reps,
      lapses: word.lapses,
      lastReviewedAt: word.lastReviewedAt,
      dueAt: word.dueAt,
      learningState: word.learningState,
    };
    return ([1, 2, 3, 4] as ReviewRating[]).map((rating) => ({
      rating,
      result: schedule(card, rating, new Date(), settings.targetRetention),
    }));
  }, [word, settings.targetRetention]);

  const listen = (text: string) => {
    setSpeechError(null);
    void speak(text, {
      accent: settings.ttsAccent,
      onError: (message) => setSpeechError(message),
    });
  };

  const flip = () => {
    if (reducedMotion) {
      setFlipped((value) => !value);
      return;
    }
    Animated.timing(flipAnim, {
      toValue: 0,
      duration: 100,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(() => {
      setFlipped((value) => !value);
      Animated.timing(flipAnim, {
        toValue: 1,
        duration: 150,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
    });
  };

  const startCheck = () => {
    setStage('check');
    setSelectedOption(null);
    setTyped('');
    setAnswer(null);
    setAnswered(false);
    wordStartedAt.current = Date.now();
  };

  const submit = (input: { optionId?: string; text?: string }) => {
    if (!question || answered) return;
    const result = gradeAnswer(question, input);
    setAnswer(result);
    setAnswered(true);
    setStage('rate');
    void Haptics.notificationAsync(
      result.correct
        ? Haptics.NotificationFeedbackType.Success
        : Haptics.NotificationFeedbackType.Warning,
    ).catch(() => undefined);
  };

  const saveRating = async (chosen: ReviewRating) => {
    if (!db || !word || !question || !answer || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const rating: ReviewRating = answer.correct ? chosen : 1;
      const preview = previews.find((item) => item.rating === rating) ?? previews[0];
      if (!preview) throw new Error('Không tính được lịch ôn.');
      if (!eventIdRef.current) eventIdRef.current = newId();

      const outcome = await recordReview(db, {
        word,
        rating,
        correct: answer.correct,
        mode: question.kind,
        durationMs: Date.now() - wordStartedAt.current,
        schedule: preview.result,
        dailyGoal: settings.dailyGoal,
        eventId: eventIdRef.current,
      });
      setReviewed((value) => value + 1);
      if (answer.correct) setCorrectCount((value) => value + 1);
      setSessionCoins((value) => value + outcome.coinChange);
      setCoinNote({ amount: outcome.coinChange, reason: outcome.coinReason });
      await notifyDataChanged();

      if (index + 1 >= words.length) {
        setStage('done');
      } else {
        setIndex((value) => value + 1);
        setStage('intro');
        setFlipped(false);
        setSelectedOption(null);
        setTyped('');
        setAnswer(null);
        setAnswered(false);
        setSpeechError(null);
        eventIdRef.current = null;
        wordStartedAt.current = Date.now();
        flipAnim.setValue(1);
      }
    } catch (error) {
      Alert.alert(
        'Không lưu được kết quả',
        error instanceof Error ? error.message : 'Thử lại sau.',
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const exit = () => {
    if (stage !== 'done' && reviewed > 0) {
      Alert.alert('Thoát buổi học?', 'Các từ bạn vừa hoàn thành đã được lưu và lên lịch ôn.', [
        { text: 'Ở lại', style: 'cancel' },
        { text: 'Thoát', style: 'destructive', onPress: pop },
      ]);
      return;
    }
    pop();
  };

  if (loading) {
    return (
      <Screen scroll={false}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
          <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.md }}>
            Đang chuẩn bị bài học…
          </AppText>
        </View>
      </Screen>
    );
  }

  if (blocked) {
    return (
      <Screen>
        <ScreenHeader title="Học từ mới" onBack={pop} />
        <Banner tone="warning" title="Cần ôn tập trước" body={blocked} />
        <PrimaryButton
          label="Đi ôn tập"
          onPress={() => {
            pop();
            push({ name: 'session', config: { mode: 'review', track } });
          }}
        />
      </Screen>
    );
  }

  if (!word || words.length === 0) {
    return (
      <Screen>
        <ScreenHeader title="Học từ mới" onBack={pop} />
        <Banner tone="info" title="Chưa có từ mới" body={empty ?? 'Bộ từ đang trống.'} />
        <PrimaryButton label="Quay lại" variant="secondary" onPress={pop} />
      </Screen>
    );
  }

  if (stage === 'done') {
    const accuracy = reviewed > 0 ? Math.round((correctCount / reviewed) * 100) : 0;
    return (
      <Screen>
        <ScreenHeader title="Xong bài mới" onBack={pop} />
        <Card style={{ alignItems: 'center', paddingVertical: spacing.xxxl }}>
          <AppText style={{ fontSize: 44 }}>{accuracy >= 80 ? '🌱' : '💪'}</AppText>
          <AppText variant="display" style={{ marginTop: spacing.md }}>
            {reviewed}
          </AppText>
          <AppText variant="body" color={colors.textMuted}>
            từ mới đã học và lên lịch ôn
          </AppText>
          <AppText variant="bodyStrong" style={{ marginTop: spacing.sm }}>
            {correctCount}/{reviewed} câu kiểm tra đúng
          </AppText>
          <AppText
            variant="bodyStrong"
            color={sessionCoins >= 0 ? colors.success : colors.danger}
            style={{ marginTop: spacing.sm }}
          >
            {sessionCoins > 0 ? '+' : ''}
            {sessionCoins.toLocaleString('vi-VN')} xu
          </AppText>
          <AppText
            variant="caption"
            color={colors.textMuted}
            style={{ marginTop: spacing.md, textAlign: 'center' }}
          >
            Từ chưa nhớ sẽ xuất hiện lại sớm trong Ôn tập. Không có từ nào bị coi là đã thuộc chỉ vì
            bạn đã lật thẻ.
          </AppText>
        </Card>
        <PrimaryButton label="Về trang Hôm nay" onPress={pop} />
      </Screen>
    );
  }

  const progress = (index + (stage === 'intro' ? 0.35 : stage === 'check' ? 0.7 : 0.95)) / words.length;

  return (
    <Screen>
      <ScreenHeader
        title={`Học từ mới · ${index + 1}/${words.length}`}
        subtitle={`${LEVEL_SHORT[word.level]} · ${TRACK_LABEL[track]}`}
        onBack={exit}
      />
      <ProgressBar value={progress} height={8} />

      {coinNote ? (
        <View style={{ marginTop: spacing.md }}>
          <Banner
            tone={coinNote.amount > 0 ? 'success' : coinNote.amount < 0 ? 'warning' : 'info'}
            title={
              coinNote.amount === 0
                ? 'Không thay đổi xu'
                : `${coinNote.amount > 0 ? '+' : ''}${coinNote.amount.toLocaleString('vi-VN')} xu`
            }
            body={coinNote.reason ?? undefined}
          />
        </View>
      ) : null}

      {stage === 'intro' ? (
        <FadeSlideIn key={`${word.id}:intro`} style={{ marginTop: spacing.lg }}>
          <Card style={{ marginBottom: spacing.md }}>
            <Animated.View style={{ transform: [{ scaleX: flipAnim }] }}>
              {flipped ? (
                <>
                  <AppText variant="micro" color={colors.textFaint}>
                    MẶT SAU · CÁCH DÙNG
                  </AppText>
                  <AppText variant="headline" style={{ marginTop: spacing.xs }}>
                    {word.term}
                  </AppText>
                  {word.definitionEn ? (
                    <AppText variant="body" color={colors.textMuted} style={{ marginTop: spacing.sm }}>
                      {word.definitionEn}
                    </AppText>
                  ) : null}
                  {word.exampleEn ? (
                    <View
                      style={[
                        styles.example,
                        { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
                      ]}
                    >
                      <AppText variant="bodyStrong">{word.exampleEn}</AppText>
                      {word.exampleVi ? (
                        <AppText variant="caption" color={colors.textMuted} style={{ marginTop: 2 }}>
                          {word.exampleVi}
                        </AppText>
                      ) : null}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Nghe câu ví dụ"
                        onPress={() => listen(word.exampleEn ?? word.term)}
                        hitSlop={8}
                        style={{ marginTop: spacing.sm }}
                      >
                        <AppText variant="caption" color={colors.primary}>
                          🔊 Nghe câu ví dụ
                        </AppText>
                      </Pressable>
                    </View>
                  ) : null}
                  {word.collocations.length > 0 ? (
                    <DetailLine label="Collocations" value={word.collocations.join(' · ')} />
                  ) : null}
                  {word.synonyms.length > 0 ? (
                    <DetailLine label="Đồng nghĩa" value={word.synonyms.join(' · ')} />
                  ) : null}
                  {word.wordFamily.length > 0 ? (
                    <DetailLine label="Word family" value={word.wordFamily.join(' · ')} />
                  ) : null}
                  {word.note ? <DetailLine label="Ghi chú" value={word.note} /> : null}
                </>
              ) : (
                <>
                  <AppText variant="micro" color={colors.textFaint}>
                    MẶT TRƯỚC · TỪ MỚI
                  </AppText>
                  <AppText variant="display" style={{ marginTop: spacing.xs }}>
                    {word.term}
                  </AppText>
                  {word.ipa ? (
                    <AppText variant="body" color={colors.textFaint}>
                      {word.ipa}
                    </AppText>
                  ) : null}
                  {word.partOfSpeech ? (
                    <AppText variant="caption" color={colors.textFaint}>
                      {word.partOfSpeech}
                    </AppText>
                  ) : null}
                  <AppText variant="title" color={colors.primary} style={{ marginTop: spacing.lg }}>
                    {word.meaningVi}
                  </AppText>
                  <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.sm }}>
                    Chạm “Lật thẻ” để xem định nghĩa, câu ví dụ và cách dùng. Không có câu hỏi nào
                    trước khi bạn hiểu từ.
                  </AppText>
                </>
              )}
            </Animated.View>

            <View style={styles.introActions}>
              <PrimaryButton
                label="🔊 Nghe"
                variant="secondary"
                style={{ flex: 1 }}
                onPress={() => listen(word.term)}
              />
              <PrimaryButton
                label={flipped ? 'Xem mặt trước' : 'Lật thẻ'}
                variant="ghost"
                style={{ flex: 1 }}
                onPress={flip}
              />
            </View>
          </Card>

          {speechError ? (
            <Banner tone="warning" title="Không phát được âm thanh" body={speechError} />
          ) : null}

          <PrimaryButton label="Tôi đã hiểu · Kiểm tra nhanh" onPress={startCheck} />
          <AppText
            variant="caption"
            color={colors.textFaint}
            style={{ marginTop: spacing.sm, textAlign: 'center' }}
          >
            Bước kiểm tra chỉ có một câu, để biết từ đã vào trí nhớ chưa chứ không phải bài thi.
          </AppText>
        </FadeSlideIn>
      ) : null}

      {stage === 'check' && question ? (
        <FadeSlideIn key={`${word.id}:check`} style={{ marginTop: spacing.lg }}>
          <Card>
            <AppText variant="micro" color={colors.primary}>
              KIỂM TRA NHANH
            </AppText>
            <AppText variant="title" style={{ marginTop: spacing.sm }}>
              {question.prompt}
            </AppText>
            {question.helper ? (
              <AppText variant="caption" color={colors.textFaint} style={{ marginTop: spacing.xs }}>
                {question.helper}
              </AppText>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Nghe phát âm"
              onPress={() => listen(word.term)}
              hitSlop={8}
              style={{ marginTop: spacing.sm }}
            >
              <AppText variant="caption" color={colors.primary}>
                🔊 Nghe lại từ
              </AppText>
            </Pressable>
          </Card>

          {question.options ? (
            <View style={{ gap: spacing.sm }}>
              {question.options.map((option) => (
                <Pressable
                  key={option.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Đáp án ${option.label}`}
                  onPress={() => {
                    setSelectedOption(option.id);
                    submit({ optionId: option.id });
                  }}
                  style={({ pressed }) => [
                    styles.option,
                    {
                      borderColor: colors.border,
                      backgroundColor: colors.surface,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  <AppText variant="bodyStrong">{option.label}</AppText>
                </Pressable>
              ))}
            </View>
          ) : (
            <View>
              <TextInput
                value={typed}
                onChangeText={setTyped}
                placeholder="Gõ từ tiếng Anh…"
                placeholderTextColor={colors.textFaint}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={() => typed.trim() && submit({ text: typed })}
                style={[
                  styles.input,
                  { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
                ]}
              />
              <PrimaryButton
                label="Kiểm tra"
                onPress={() => submit({ text: typed })}
                disabled={!typed.trim()}
                style={{ marginTop: spacing.md }}
              />
            </View>
          )}
        </FadeSlideIn>
      ) : null}

      {stage === 'rate' && answer ? (
        <FadeSlideIn key={`${word.id}:rate`} style={{ marginTop: spacing.lg }}>
          <Banner
            tone={answer.correct ? 'success' : 'warning'}
            title={answer.correct ? 'Đúng — từ đã được ghi nhận' : 'Chưa đúng'}
            body={
              answer.correct
                ? 'Bạn tự thấy từ này thế nào? Lựa chọn ảnh hưởng tới lần ôn tiếp theo.'
                : `Đáp án: ${question?.answerText ?? word.term}. Từ này sẽ quay lại sớm, không bị trừ xu ở lần học đầu.`
            }
          />
          <Card style={{ marginTop: spacing.md }}>
            <AppText variant="headline">{word.term}</AppText>
            {word.ipa ? (
              <AppText variant="caption" color={colors.textFaint}>
                {word.ipa}
              </AppText>
            ) : null}
            <AppText variant="body" color={colors.textMuted} style={{ marginTop: spacing.sm }}>
              {word.meaningVi}
            </AppText>
            {word.exampleEn ? (
              <AppText variant="caption" color={colors.textFaint} style={{ marginTop: spacing.sm }}>
                {word.exampleEn}
              </AppText>
            ) : null}
          </Card>

          {answer.correct ? (
            <>
              <AppText variant="micro" color={colors.textFaint} style={{ marginTop: spacing.md }}>
                BẠN THẤY TỪ NÀY THẾ NÀO?
              </AppText>
              <View style={styles.ratingRow}>
                {previews.map(({ rating, result }) => (
                  <Pressable
                    key={rating}
                    accessibilityRole="button"
                    accessibilityLabel={`${RATING_LABELS[rating]}, lần tới sau ${describeInterval(result.intervalDays)}`}
                    disabled={saving}
                    onPress={() => void saveRating(rating)}
                    style={({ pressed }) => [
                      styles.ratingButton,
                      {
                        borderColor: colors.border,
                        backgroundColor: rating === 3 ? colors.primarySoft : colors.surface,
                        opacity: pressed || saving ? 0.6 : 1,
                      },
                    ]}
                  >
                    <AppText variant="bodyStrong" color={rating === 3 ? colors.primary : colors.text}>
                      {RATING_LABELS[rating]}
                    </AppText>
                    <AppText variant="micro" color={colors.textFaint}>
                      {describeInterval(result.intervalDays)}
                    </AppText>
                  </Pressable>
                ))}
              </View>
            </>
          ) : (
            <PrimaryButton
              label="Đã hiểu · Từ này quay lại sớm"
              onPress={() => void saveRating(1)}
              loading={saving}
              style={{ marginTop: spacing.md }}
            />
          )}
        </FadeSlideIn>
      ) : null}
    </Screen>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ marginTop: spacing.sm }}>
      <AppText variant="micro" color={colors.textFaint}>
        {label.toUpperCase()}
      </AppText>
      <AppText variant="caption" color={colors.textMuted}>
        {value}
      </AppText>
    </View>
  );
}

const TRACK_LABEL: Record<Track, string> = {
  general: 'General English',
  ielts: 'IELTS Vocabulary',
};

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  introActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  example: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  option: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    fontSize: 18,
  },
  ratingRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  ratingButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    gap: 2,
  },
});

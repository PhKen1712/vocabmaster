import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';

import { AppText, Banner, Card, PrimaryButton, ProgressBar, Screen } from '../components/ui';
import { ScreenHeader } from '../components/patterns';
import { getDueWords, getNewWords, getWeakWords, listWords } from '../db/words';
import { recordReview } from '../db/reviews';
import { formatDuration } from '../lib/date';
import { displayTerm } from '../lib/text';
import { useNavigation, type SessionConfig } from '../navigation/NavigationProvider';
import { generateQuestions } from '../quiz/generator';
import { gradeAnswer, type GradeResult } from '../quiz/grading';
import { describeInterval, schedule, type ScheduleResult } from '../srs/fsrs';
import { speak } from '../speech/tts';
import { useSpeechCheck } from '../speech/useSpeechCheck';
import { useApp } from '../state/AppProvider';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/tokens';
import {
  LEVEL_SHORT,
  TRACK_LABELS,
  type QuizQuestion,
  type ReviewRating,
  type Word,
} from '../types';

type Phase = 'question' | 'feedback' | 'done';

const RATING_LABELS: Record<ReviewRating, string> = {
  1: 'Lại',
  2: 'Khó',
  3: 'Nhớ',
  4: 'Dễ',
};

export function SessionScreen({ config }: { config: SessionConfig }) {
  const { db, settings, notifyDataChanged } = useApp();
  const { pop } = useNavigation();
  const { colors } = useTheme();

  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('question');
  const [grade, setGrade] = useState<GradeResult | null>(null);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [emptyReason, setEmptyReason] = useState<string | null>(null);
  const [stats, setStats] = useState({ answered: 0, correct: 0 });
  const [wrongQuestions, setWrongQuestions] = useState<QuizQuestion[]>([]);
  const [retried, setRetried] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);

  const startedAt = useRef(Date.now());
  const questionStartedAt = useRef(Date.now());
  const speech = useSpeechCheck();

  const question = questions[index] ?? null;
  const accent = settings.ttsAccent;

  const load = useCallback(async () => {
    if (!db) return;
    setLoading(true);
    try {
      const pool = await listWords(db, { track: config.track, limit: 400 });
      let candidates: Word[] = [];
      const level = config.level ?? settings.level;

      if (config.mode === 'review') {
        candidates = await getDueWords(db, config.track, 30);
      } else if (config.mode === 'new') {
        candidates = await getNewWords(db, config.track, level, Math.min(30, settings.dailyGoal));
      } else if (config.mode === 'weak') {
        const weak = await getWeakWords(db, config.track, 12);
        candidates = weak.map((row) => row.word);
      } else if (config.mode === 'topic') {
        candidates = config.topic
          ? await listWords(db, { track: config.track, topic: config.topic, limit: 25 })
          : [];
      } else {
        const due = await getDueWords(db, config.track, 20);
        const fresh = await getNewWords(db, config.track, level, Math.max(3, settings.dailyGoal));
        candidates = [...due, ...fresh];
      }

      const built = generateQuestions(candidates, pool.length > 0 ? pool : candidates, {
        limit: Math.min(20, candidates.length),
      });
      setQuestions(built);
      setIndex(0);
      setPhase('question');
      setGrade(null);
      setSelectedOption(null);
      setTyped('');
      setRevealed(false);
      setRetried(false);
      setWrongQuestions([]);
      setStats({ answered: 0, correct: 0 });
      startedAt.current = Date.now();
      questionStartedAt.current = Date.now();

      if (built.length === 0) {
        setEmptyReason(
          config.mode === 'review'
            ? 'Không có từ nào đến hạn ôn. Hãy học từ mới hoặc quay lại sau.'
            : config.mode === 'new'
              ? 'Bạn đã học hết từ mới ở cấp độ này. Giảm cấp độ hoặc thêm từ mới.'
              : config.mode === 'weak'
                ? 'Chưa có dữ liệu về từ hay sai. Hãy làm vài buổi học trước.'
                : 'Chưa có từ phù hợp để tạo buổi học.',
        );
      } else {
        setEmptyReason(null);
      }
    } finally {
      setLoading(false);
    }
  }, [db, config, settings.dailyGoal, settings.level]);

  useEffect(() => {
    void load();
  }, [load]);

  // Listening questions speak automatically once, and stop when moving on.
  useEffect(() => {
    if (question?.kind === 'listening') {
      void speak(question.word.term, { accent });
    }
    return () => {
      speech.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question?.id, accent]);

  const previews = useMemo(() => {
    if (!question) return [] as { rating: ReviewRating; result: ScheduleResult }[];
    const card = {
      stability: question.word.stability,
      difficulty: question.word.difficulty,
      reps: question.word.reps,
      lapses: question.word.lapses,
      lastReviewedAt: question.word.lastReviewedAt,
      dueAt: question.word.dueAt,
      learningState: question.word.learningState,
    };
    return ([1, 2, 3, 4] as ReviewRating[]).map((rating) => ({
      rating,
      result: schedule(card, rating, new Date(), settings.targetRetention),
    }));
  }, [question, settings.targetRetention]);

  const finishWithGrade = useCallback(
    (result: GradeResult) => {
      setGrade(result);
      setPhase('feedback');
      setStats((previous) => ({
        answered: previous.answered + 1,
        correct: previous.correct + (result.correct ? 1 : 0),
      }));
      if (!result.correct) {
        const current = questions[index];
        if (current) {
          setWrongQuestions((previous) =>
            previous.some((item) => item.wordId === current.wordId)
              ? previous
              : [...previous, current],
          );
        }
      }
      void Haptics.notificationAsync(
        result.correct
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Warning,
      ).catch(() => undefined);
    },
    [index, questions],
  );

  const answerOption = (optionId: string) => {
    if (!question || phase !== 'question') return;
    setSelectedOption(optionId);
    finishWithGrade(gradeAnswer(question, { optionId }));
  };

  const submitTyped = () => {
    if (!question || phase !== 'question') return;
    if (!typed.trim()) return;
    finishWithGrade(gradeAnswer(question, { text: typed }));
  };

  const submitSpeaking = () => {
    if (!question || phase !== 'question') return;
    const transcript = speech.result?.transcript ?? speech.transcript;
    if (!transcript.trim()) {
      setSpeechError('Chưa có kết quả nhận diện. Hãy bấm micro và đọc từ.');
      return;
    }
    finishWithGrade(gradeAnswer(question, { text: transcript }));
  };

  const saveRating = async (rating: ReviewRating) => {
    if (!db || !question || !grade || saving) return;
    setSaving(true);
    try {
      const preview = previews.find((item) => item.rating === rating);
      if (!preview) throw new Error('Không tính được lịch ôn.');
      await recordReview(db, {
        word: question.word,
        rating,
        correct: grade.correct,
        mode: question.kind,
        durationMs: Date.now() - questionStartedAt.current,
        schedule: preview.result,
        dailyGoal: settings.dailyGoal,
      });
      await notifyDataChanged();

      if (index + 1 >= questions.length) {
        setPhase('done');
      } else {
        setIndex((value) => value + 1);
        setPhase('question');
        setGrade(null);
        setSelectedOption(null);
        setTyped('');
        setRevealed(false);
        setSpeechError(null);
        speech.reset();
        questionStartedAt.current = Date.now();
      }
    } catch (error) {
      Alert.alert(
        'Không lưu được kết quả',
        error instanceof Error ? error.message : 'Thử lại sau.',
      );
    } finally {
      setSaving(false);
    }
  };

  /** Skip without recording anything — used when the microphone is unavailable. */
  const skipCurrent = () => {
    if (index + 1 >= questions.length) {
      setPhase('done');
      return;
    }
    setIndex((value) => value + 1);
    setPhase('question');
    setGrade(null);
    setSelectedOption(null);
    setTyped('');
    setRevealed(false);
    setSpeechError(null);
    speech.reset();
    questionStartedAt.current = Date.now();
  };

  const retryWrong = () => {
    if (wrongQuestions.length === 0) return;
    setQuestions(wrongQuestions);
    setIndex(0);
    setPhase('question');
    setGrade(null);
    setSelectedOption(null);
    setTyped('');
    setRevealed(false);
    setRetried(true);
    setWrongQuestions([]);
    questionStartedAt.current = Date.now();
  };

  const exit = () => {
    if (phase !== 'done' && stats.answered > 0) {
      Alert.alert('Thoát buổi học?', 'Tiến độ của buổi này đã được lưu sau mỗi câu.', [
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
            Đang chuẩn bị câu hỏi…
          </AppText>
        </View>
      </Screen>
    );
  }

  if (questions.length === 0 || !question) {
    return (
      <Screen>
        <ScreenHeader title="Buổi học" onBack={pop} />
        <Banner tone="info" title="Chưa thể bắt đầu" body={emptyReason ?? 'Không có câu hỏi.'} />
        <PrimaryButton label="Quay lại" variant="secondary" onPress={pop} />
      </Screen>
    );
  }

  if (phase === 'done') {
    const accuracy = stats.answered > 0 ? Math.round((stats.correct / stats.answered) * 100) : 0;
    return (
      <Screen>
        <ScreenHeader title="Hoàn thành" onBack={pop} />
        <Card style={{ alignItems: 'center', paddingVertical: spacing.xxxl }}>
          <AppText style={{ fontSize: 44 }}>{accuracy >= 80 ? '🎉' : '💪'}</AppText>
          <AppText variant="display" style={{ marginTop: spacing.md }}>
            {accuracy}%
          </AppText>
          <AppText variant="body" color={colors.textMuted}>
            {stats.correct}/{stats.answered} câu đúng · {formatDuration(Date.now() - startedAt.current)}
          </AppText>
          <View style={{ alignSelf: 'stretch', marginTop: spacing.lg }}>
            <ProgressBar value={accuracy / 100} height={10} />
          </View>
          <AppText
            variant="caption"
            color={colors.textMuted}
            style={{ marginTop: spacing.lg, textAlign: 'center' }}
          >
            Lịch ôn của từng từ đã được cập nhật. Từ trả lời sai sẽ quay lại sớm hơn.
          </AppText>
        </Card>

        {wrongQuestions.length > 0 && !retried ? (
          <PrimaryButton
            label={`Làm lại ${wrongQuestions.length} từ vừa sai`}
            onPress={retryWrong}
            style={{ marginTop: spacing.md }}
          />
        ) : null}
        <PrimaryButton
          label={retried ? 'Kết thúc' : 'Về trang Hôm nay'}
          variant="secondary"
          onPress={pop}
          style={{ marginTop: spacing.md }}
        />
      </Screen>
    );
  }

  const progress = (index + (phase === 'feedback' ? 1 : 0)) / questions.length;
  const isSpeakingQuestion = question.kind === 'speaking';

  return (
    <Screen>
      <ScreenHeader
        title={`Câu ${index + 1}/${questions.length}`}
        subtitle={`${TRACK_LABELS[config.track]} · ${LEVEL_SHORT[question.word.level]}`}
        onBack={exit}
      />
      <ProgressBar value={progress} height={8} />

      <Card style={{ marginTop: spacing.lg, marginBottom: spacing.lg }}>
        <View style={styles.kindRow}>
          <AppText variant="micro" color={colors.primary}>
            {kindLabel(question.kind).toUpperCase()}
          </AppText>
          {question.kind !== 'speaking' && question.kind !== 'typing' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Nghe phát âm"
              onPress={() => speak(question.word.term, { accent })}
              hitSlop={10}
            >
              <AppText variant="body" color={colors.primary}>
                🔊
              </AppText>
            </Pressable>
          ) : null}
        </View>

        <AppText variant="title" style={{ marginTop: spacing.sm }}>
          {question.kind === 'recall' && !revealed ? question.word.term : question.prompt}
        </AppText>
        {question.kind === 'recall' && !revealed ? (
          <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.xs }}>
            Tự nhớ nghĩa của từ, sau đó mở đáp án để tự đánh giá.
          </AppText>
        ) : null}
        {question.helper ? (
          <AppText variant="caption" color={colors.textFaint} style={{ marginTop: spacing.xs }}>
            {question.helper}
          </AppText>
        ) : null}
        {question.kind === 'listening' ? (
          <PrimaryButton
            label="Nghe lại"
            variant="ghost"
            onPress={() => speak(question.word.term, { accent })}
            style={{ marginTop: spacing.md }}
          />
        ) : null}
      </Card>

      {question.options ? (
        <View style={{ gap: spacing.sm }}>
          {question.options.map((option) => {
            const chosen = selectedOption === option.id;
            const correct = phase === 'feedback' && option.id === question.answerId;
            const wrongChoice = phase === 'feedback' && chosen && option.id !== question.answerId;
            return (
              <Pressable
                key={option.id}
                accessibilityRole="button"
                accessibilityLabel={`Đáp án ${option.label}`}
                disabled={phase !== 'question'}
                onPress={() => answerOption(option.id)}
                style={({ pressed }) => [
                  styles.option,
                  {
                    borderColor: correct
                      ? colors.success
                      : wrongChoice
                        ? colors.danger
                        : chosen
                          ? colors.primary
                          : colors.border,
                    backgroundColor: correct
                      ? colors.successSoft
                      : wrongChoice
                        ? colors.dangerSoft
                        : colors.surface,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <AppText variant="bodyStrong" style={{ flex: 1 }}>
                  {option.label}
                </AppText>
                {correct ? <AppText color={colors.success}>✓</AppText> : null}
                {wrongChoice ? <AppText color={colors.danger}>✕</AppText> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {question.kind === 'typing' && phase === 'question' ? (
        <View>
          <TextInput
            value={typed}
            onChangeText={setTyped}
            placeholder="Nhập từ tiếng Anh…"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={submitTyped}
            style={[
              styles.input,
              { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
            ]}
          />
          <PrimaryButton
            label="Kiểm tra"
            onPress={submitTyped}
            disabled={!typed.trim()}
            style={{ marginTop: spacing.md }}
          />
        </View>
      ) : null}

      {question.kind === 'recall' && phase === 'question' ? (
        <View>
          {revealed ? (
            <>
              <Card soft style={{ marginBottom: spacing.md }}>
                <AppText variant="bodyStrong">{question.word.meaningVi}</AppText>
                {question.word.exampleEn ? (
                  <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.sm }}>
                    {question.word.exampleEn}
                  </AppText>
                ) : null}
              </Card>
              <View style={styles.recallButtons}>
                <PrimaryButton
                  label="Chưa nhớ"
                  variant="secondary"
                  style={{ flex: 1 }}
                  onPress={() => {
                    setGrade({
                      correct: false,
                      normalized: '',
                      expected: question.word.meaningVi,
                      nearMiss: false,
                    });
                    setPhase('feedback');
                    setStats((previous) => ({ ...previous, answered: previous.answered + 1 }));
                    setWrongQuestions((previous) => [...previous, question]);
                  }}
                />
                <PrimaryButton
                  label="Đã nhớ"
                  style={{ flex: 1 }}
                  onPress={() => {
                    setGrade({
                      correct: true,
                      normalized: '',
                      expected: question.word.meaningVi,
                      nearMiss: false,
                    });
                    setPhase('feedback');
                    setStats((previous) => ({
                      answered: previous.answered + 1,
                      correct: previous.correct + 1,
                    }));
                  }}
                />
              </View>
            </>
          ) : (
            <PrimaryButton label="Hiện nghĩa" onPress={() => setRevealed(true)} />
          )}
        </View>
      ) : null}

      {isSpeakingQuestion && phase === 'question' ? (
        <View>
          <Banner
            tone="info"
            title="Luyện nói"
            body="Ứng dụng kiểm tra bạn đã đọc đúng từ hay chưa bằng nhận diện giọng nói. Đây không phải điểm phát âm từng âm vị."
          />
          <PrimaryButton
            label={speech.listening ? 'Đang nghe…' : 'Bắt đầu đọc'}
            icon="🎙"
            onPress={() => void speech.start(question)}
            disabled={speech.listening}
          />
          {speech.transcript ? (
            <Card soft style={{ marginTop: spacing.md }}>
              <AppText variant="micro" color={colors.textFaint}>
                HỆ THỐNG NGHE ĐƯỢC
              </AppText>
              <AppText variant="bodyStrong" style={{ marginTop: 2 }}>
                {speech.transcript}
              </AppText>
              {speech.result ? (
                <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.sm }}>
                  {speech.result.note}
                  {speech.result.missedWords.length > 0
                    ? ` Chưa khớp: ${speech.result.missedWords.join(', ')}.`
                    : ''}
                </AppText>
              ) : null}
            </Card>
          ) : null}
          {speech.error ? (
            <Banner tone="warning" title="Chưa dùng được micro" body={speech.error} />
          ) : null}
          {speech.listening ? (
            <PrimaryButton
              label="Dừng ghi âm"
              variant="secondary"
              onPress={speech.stop}
              style={{ marginTop: spacing.md }}
            />
          ) : null}
          {speech.transcript ? (
            <PrimaryButton
              label="Ghi nhận kết quả"
              variant="secondary"
              onPress={submitSpeaking}
              style={{ marginTop: spacing.md }}
            />
          ) : null}
          {speechError ? (
            <AppText variant="caption" color={colors.danger} style={{ marginTop: spacing.sm }}>
              {speechError}
            </AppText>
          ) : null}
          <PrimaryButton
            label="Bỏ qua câu này (không tính)"
            variant="ghost"
            onPress={skipCurrent}
            style={{ marginTop: spacing.md }}
          />
        </View>
      ) : null}

      {phase === 'feedback' && grade ? (
        <View style={{ marginTop: spacing.lg }}>
          <Banner
            tone={grade.correct ? 'success' : 'danger'}
            title={grade.correct ? 'Chính xác' : 'Chưa đúng'}
            body={
              grade.correct
                ? undefined
                : grade.nearMiss
                  ? `Gần đúng — kiểm tra lại chính tả. Đáp án: ${question.answerText}`
                  : `Đáp án đúng: ${question.answerText}`
            }
          />
          {question.word.exampleEn ? (
            <Card soft style={{ marginBottom: spacing.md }}>
              <AppText variant="body">{question.word.exampleEn}</AppText>
              {question.word.exampleVi ? (
                <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.xs }}>
                  {question.word.exampleVi}
                </AppText>
              ) : null}
            </Card>
          ) : null}

          <AppText variant="micro" color={colors.textFaint} style={{ marginBottom: spacing.sm }}>
            BẠN THẤY TỪ NÀY THẾ NÀO?
          </AppText>
          <View style={styles.ratingRow}>
            {previews.map(({ rating, result }) => (
              <Pressable
                key={rating}
                accessibilityRole="button"
                accessibilityLabel={`Đánh giá ${RATING_LABELS[rating]}, lần tới sau ${describeInterval(result.intervalDays)}`}
                disabled={saving}
                onPress={() => void saveRating(rating)}
                style={({ pressed }) => [
                  styles.ratingButton,
                  {
                    borderColor: colors.border,
                    backgroundColor:
                      rating === 3 ? colors.primarySoft : colors.surface,
                    opacity: pressed || saving ? 0.6 : 1,
                  },
                ]}
              >
                <AppText
                  variant="bodyStrong"
                  color={rating === 3 ? colors.primary : colors.text}
                >
                  {RATING_LABELS[rating]}
                </AppText>
                <AppText variant="micro" color={colors.textFaint}>
                  {describeInterval(result.intervalDays)}
                </AppText>
              </Pressable>
            ))}
          </View>
          <AppText variant="caption" color={colors.textFaint} style={{ marginTop: spacing.sm }}>
            Lịch ôn được tính bằng FSRS từ lịch sử trả lời của bạn.
          </AppText>
        </View>
      ) : null}

    </Screen>
  );
}

function kindLabel(kind: QuizQuestion['kind']): string {
  switch (kind) {
    case 'en_to_vi':
      return 'Anh → Việt';
    case 'vi_to_en':
      return 'Việt → Anh';
    case 'typing':
      return 'Viết từ';
    case 'cloze':
      return 'Điền vào câu';
    case 'context':
      return 'Chọn theo ngữ cảnh';
    case 'listening':
      return 'Nghe hiểu';
    case 'speaking':
      return 'Luyện nói';
    case 'confusable':
      return 'Phân biệt từ';
    case 'recall':
      return 'Tự nhớ';
    default:
      return 'Ôn tập';
  }
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  kindRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    fontSize: 18,
  },
  recallButtons: { flexDirection: 'row', gap: spacing.md },
  ratingRow: { flexDirection: 'row', gap: spacing.sm },
  ratingButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    gap: 2,
  },
});

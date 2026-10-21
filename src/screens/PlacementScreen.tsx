import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Banner, Card, PrimaryButton, ProgressBar, Screen } from '../components/ui';
import { ScreenHeader } from '../components/patterns';
import { listWords } from '../db/words';
import { gradeAnswer } from '../quiz/grading';
import { buildPlacementQuestions, isAnswerable, recommendLevel } from '../quiz/placement';
import { useNavigation } from '../navigation/NavigationProvider';
import { useApp } from '../state/AppProvider';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/tokens';
import { LEVEL_SHORT, type QuizQuestion } from '../types';

/**
 * Placement is a self-check, not an exam. It samples one word from each
 * available level, then recommends a starting level. The learner always keeps
 * the final choice, and can skip this entirely.
 *
 * Question building lives in `src/quiz/placement.ts` so it can be unit tested,
 * including the rule that every question must have selectable options.
 */

export function PlacementScreen() {
  const { db, settings, updateSettings } = useApp();
  const { pop, goToTab } = useNavigation();
  const { colors } = useTheme();

  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    if (!db) return;
    setLoading(true);
    try {
      const pool = await listWords(db, { track: settings.track, limit: 300 });
      setQuestions(buildPlacementQuestions(pool));
    } finally {
      setLoading(false);
    }
  }, [db, settings.track]);

  useEffect(() => {
    void load();
  }, [load]);

  const question = questions[index] ?? null;
  const answerable = isAnswerable(question);

  const choose = (optionId: string) => {
    if (!answerable || answered) return;
    const result = gradeAnswer(question, { optionId });
    setPicked(optionId);
    setAnswered(true);
    if (result.correct) setCorrect((value) => value + 1);
  };

  const next = () => {
    if (index + 1 >= questions.length) {
      setDone(true);
      return;
    }
    setIndex((value) => value + 1);
    setPicked(null);
    setAnswered(false);
  };

  const apply = async () => {
    const recommended = recommendLevel(correct, questions.length);
    await updateSettings({
      track: settings.track,
      level: recommended,
      onboardingDone: true,
    });
    goToTab('today');
  };

  if (loading) {
    return (
      <Screen scroll={false}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
          <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.md }}>
            Đang chọn từ mẫu theo cấp độ…
          </AppText>
        </View>
      </Screen>
    );
  }

  if (questions.length === 0) {
    return (
      <Screen>
        <ScreenHeader title="Kiểm tra đầu vào" onBack={pop} />
        <Banner
          tone="warning"
          title="Chưa đủ dữ liệu"
          body="Bộ từ hiện tại chưa có đủ từ để kiểm tra. Hãy chọn cấp độ thủ công."
        />
        <PrimaryButton label="Quay lại" onPress={pop} />
      </Screen>
    );
  }

  if (done) {
    const recommended = recommendLevel(correct, questions.length);
    return (
      <Screen>
        <ScreenHeader title="Kết quả gợi ý" onBack={pop} />
        <Card style={{ alignItems: 'center', paddingVertical: spacing.xxl }}>
          <AppText variant="display">
            {correct}/{questions.length}
          </AppText>
          <AppText variant="body" color={colors.textMuted} style={{ marginTop: spacing.sm }}>
            câu đúng
          </AppText>
          <View style={{ alignSelf: 'stretch', marginTop: spacing.lg }}>
            <ProgressBar value={correct / questions.length} height={10} />
          </View>
          <AppText variant="headline" style={{ marginTop: spacing.xl }}>
            Gợi ý: {LEVEL_SHORT[recommended]}
          </AppText>
          <AppText
            variant="caption"
            color={colors.textMuted}
            style={{ marginTop: spacing.xs, textAlign: 'center' }}
          >
            Đây chỉ là gợi ý dựa trên 6 từ mẫu, không phải điểm trình độ chính thức. Bạn có thể đổi
            cấp độ bất cứ lúc nào.
          </AppText>
        </Card>
        <PrimaryButton
          label={`Bắt đầu ở ${LEVEL_SHORT[recommended]}`}
          onPress={() => void apply()}
          style={{ marginTop: spacing.lg }}
        />
        <PrimaryButton
          label="Giữ cấp độ hiện tại"
          variant="ghost"
          onPress={async () => {
            await updateSettings({ onboardingDone: true });
            goToTab('today');
          }}
          style={{ marginTop: spacing.sm }}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader
        title={`Câu ${index + 1}/${questions.length}`}
        subtitle="Chọn nghĩa đúng. Bỏ qua được bất cứ lúc nào."
        onBack={pop}
      />
      <ProgressBar value={index / questions.length} />

      <Card style={{ marginTop: spacing.lg }}>
        <AppText variant="micro" color={colors.primary}>
          {LEVEL_SHORT[question?.word.level ?? 1]}
        </AppText>
        <AppText variant="title" style={{ marginTop: spacing.xs }}>
          {question?.prompt}
        </AppText>
        {question?.helper ? (
          <AppText variant="caption" color={colors.textFaint}>
            {question.helper}
          </AppText>
        ) : null}
      </Card>

      <View style={{ gap: spacing.sm }}>
        {(question?.options ?? []).map((option) => {
          const isCorrect = answered && option.id === question?.answerId;
          const isWrong = answered && picked === option.id && option.id !== question?.answerId;
          return (
            <Pressable
              key={option.id}
              disabled={answered}
              onPress={() => choose(option.id)}
              style={[
                styles.option,
                {
                  borderColor: isCorrect ? colors.success : isWrong ? colors.danger : colors.border,
                  backgroundColor: isCorrect
                    ? colors.successSoft
                    : isWrong
                      ? colors.dangerSoft
                      : colors.surface,
                },
              ]}
            >
              <AppText variant="bodyStrong" style={{ flex: 1 }}>
                {option.label}
              </AppText>
              {isCorrect ? <AppText color={colors.success}>✓</AppText> : null}
              {isWrong ? <AppText color={colors.danger}>✕</AppText> : null}
            </Pressable>
          );
        })}
      </View>

      {!answerable ? (
        <>
          <View style={{ marginTop: spacing.lg }}>
            <Banner
              tone="warning"
              title="Câu này thiếu lựa chọn"
              body="Không có đáp án để chọn nên câu này được bỏ qua, không tính điểm."
            />
          </View>
          <PrimaryButton
            label={index + 1 >= questions.length ? 'Xem kết quả' : 'Bỏ qua câu này'}
            onPress={next}
            style={{ marginTop: spacing.md }}
          />
        </>
      ) : answered ? (
        <PrimaryButton
          label={index + 1 >= questions.length ? 'Xem kết quả' : 'Câu tiếp theo'}
          onPress={next}
          style={{ marginTop: spacing.lg }}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
});

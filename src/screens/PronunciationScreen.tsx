import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Switch, View } from 'react-native';

import { AppText, Banner, Card, PrimaryButton, Screen } from '../components/ui';
import { ScreenHeader } from '../components/patterns';
import { getWord } from '../db/words';
import { useNavigation } from '../navigation/NavigationProvider';
import { pronunciationQuestion } from '../speech/pronunciation';
import { speak } from '../speech/tts';
import { useSpeechCheck } from '../speech/useSpeechCheck';
import { useApp } from '../state/AppProvider';
import { useTheme } from '../theme/ThemeProvider';
import { spacing } from '../theme/tokens';
import { LEVEL_SHORT, TRACK_LABELS, type Word } from '../types';

/**
 * Pronunciation lab for one saved word.
 *
 * Honest by design: Apple's recogniser tells us whether the target was heard,
 * not how well each phoneme was pronounced. The copy says that everywhere and
 * no invented score is shown. Practice never touches coins or the streak.
 */
export function PronunciationScreen({ id }: { id: string }) {
  const { db, settings } = useApp();
  const { pop } = useNavigation();
  const { colors } = useTheme();
  const [word, setWord] = useState<Word | null>(null);
  const [loading, setLoading] = useState(true);
  const speech = useSpeechCheck();
  const stopRef = useRef(speech.stop);
  stopRef.current = speech.stop;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!db) return;
      const found = await getWord(db, id);
      if (cancelled) return;
      setWord(found);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
      stopRef.current();
    };
  }, [db, id]);

  const question = useMemo(() => (word ? pronunciationQuestion(word) : null), [word]);

  const start = useCallback(() => {
    if (!question) return;
    speech.reset();
    void speech.start(question);
  }, [question, speech]);

  const retryWithNetwork = useCallback(() => {
    if (!question) return;
    speech.setOnDevice(false);
    speech.reset();
    void speech.start(question);
  }, [question, speech]);

  if (loading) {
    return (
      <Screen scroll={false}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  if (!word || !question) {
    return (
      <Screen>
        <ScreenHeader title="Luyện phát âm" onBack={pop} />
        <Banner tone="warning" title="Không tìm thấy từ" body="Từ này có thể đã bị xoá." />
        <PrimaryButton label="Quay lại" onPress={pop} />
      </Screen>
    );
  }

  const listening = speech.listening;
  const processing = speech.processing;
  const result = speech.result;

  return (
    <Screen>
      <ScreenHeader
        title="Luyện phát âm"
        subtitle={`${TRACK_LABELS[word.track]} · ${LEVEL_SHORT[word.level]}`}
        onBack={() => {
          speech.stop();
          pop();
        }}
      />

      <Card style={{ marginBottom: spacing.md }}>
        <AppText variant="display">{word.term}</AppText>
        <View style={styles.ipaRow}>
          {word.ipa ? (
            <AppText variant="body" color={colors.textMuted}>
              {word.ipa}
            </AppText>
          ) : (
            <AppText variant="caption" color={colors.textFaint}>
              Chưa có phiên âm IPA
            </AppText>
          )}
          {word.partOfSpeech ? (
            <AppText variant="caption" color={colors.textFaint}>
              {word.partOfSpeech}
            </AppText>
          ) : null}
        </View>
        <AppText variant="body" color={colors.textMuted} style={{ marginTop: spacing.sm }}>
          {word.meaningVi}
        </AppText>
        <PrimaryButton
          label="Nghe giọng mẫu"
          icon="🔊"
          variant="secondary"
          onPress={() => void speak(word.term, { accent: settings.ttsAccent, voice: settings.ttsVoice })}
          style={{ marginTop: spacing.md }}
        />
      </Card>

      <Card soft style={{ marginBottom: spacing.md }}>
        <AppText variant="bodyStrong">Bắt đầu nói</AppText>
        <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.xs }}>
          Nhấn micro, đọc to từ ở trên rồi dừng. Ứng dụng chỉ kiểm tra hệ thống có nhận ra đúng từ hay
          không — không chấm điểm từng âm vị và không lưu âm thanh của bạn.
        </AppText>

        {listening ? (
          <View style={styles.statusRow}>
            <ActivityIndicator color={colors.primary} />
            <AppText variant="bodyStrong" color={colors.primary}>
              Đang nghe…
            </AppText>
          </View>
        ) : processing ? (
          <View style={styles.statusRow}>
            <ActivityIndicator color={colors.primary} />
            <AppText variant="caption" color={colors.textMuted}>
              Đang xử lý giọng nói…
            </AppText>
          </View>
        ) : null}

        {!listening ? (
          <PrimaryButton
            label={result ? 'Nói lại' : 'Bắt đầu đọc'}
            icon="🎙"
            onPress={start}
            style={{ marginTop: spacing.md }}
          />
        ) : (
          <PrimaryButton
            label="Dừng ghi âm"
            variant="secondary"
            onPress={speech.stop}
            style={{ marginTop: spacing.md }}
          />
        )}
      </Card>

      {speech.error ? (
        <>
          <Banner
            tone="warning"
            title="Chưa dùng được micro"
            body={`${speech.error} Hãy kiểm tra Cài đặt iOS → VocabMaster → Micro và Nhận diện giọng nói.`}
          />
          {speech.onDevice ? (
            <PrimaryButton
              label="Thử nhận diện qua mạng"
              variant="ghost"
              onPress={retryWithNetwork}
              style={{ marginBottom: spacing.md }}
            />
          ) : null}
        </>
      ) : null}

      {speech.transcript ? (
        <Card soft style={{ marginBottom: spacing.md }}>
          <AppText variant="micro" color={colors.textFaint}>
            HỆ THỐNG NGHE ĐƯỢC
          </AppText>
          <AppText variant="headline" style={{ marginTop: 2 }}>
            {speech.transcript}
          </AppText>
          {result ? (
            <AppText
              variant="bodyStrong"
              color={result.wordMatched ? colors.success : colors.warning}
              style={{ marginTop: spacing.sm }}
            >
              {result.wordMatched ? 'Đã nhận ra đúng từ mục tiêu' : 'Chưa nhận ra từ mục tiêu'}
            </AppText>
          ) : (
            <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.sm }}>
              Đang chờ kết quả cuối…
            </AppText>
          )}
          {result && result.missedWords.length > 0 ? (
            <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.xs }}>
              Chưa khớp: {result.missedWords.join(', ')}
            </AppText>
          ) : null}
          {result ? (
            <AppText variant="caption" color={colors.textFaint} style={{ marginTop: spacing.sm }}>
              {result.note}
            </AppText>
          ) : null}
        </Card>
      ) : null}

      <Card soft>
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <AppText variant="bodyStrong">Nhận diện trên thiết bị</AppText>
            <AppText variant="caption" color={colors.textMuted}>
              Âm thanh không rời khỏi iPhone. Tắt để thử nhận diện qua mạng khi máy chưa có gói
              tiếng Anh ngoại tuyến.
            </AppText>
          </View>
          <Switch
            value={speech.onDevice}
            onValueChange={speech.setOnDevice}
            trackColor={{ true: colors.primary, false: colors.border }}
          />
        </View>
        <AppText variant="caption" color={colors.textFaint} style={{ marginTop: spacing.sm }}>
          Không cộng hoặc trừ xu, không thay đổi chuỗi ngày học. Đây là phần luyện tập tự do.
        </AppText>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  ipaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
});

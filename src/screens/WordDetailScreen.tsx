import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Banner, Card, PrimaryButton, Screen, SectionHeader } from '../components/ui';
import { DICT_FIELD_LABELS } from '../dict/types';
import { ScreenHeader } from '../components/patterns';
import { deleteWord, getWord, setFavorite } from '../db/words';
import { getWordHistory } from '../db/reviews';
import { formatRelativeDue } from '../lib/date';
import { displayTerm, formatList } from '../lib/text';
import { useNavigation } from '../navigation/NavigationProvider';
import { speak } from '../speech/tts';
import { useApp } from '../state/AppProvider';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/tokens';
import { LEVEL_LABELS, TRACK_LABELS, type ReviewLog, type Word } from '../types';

export function WordDetailScreen({ id }: { id: string }) {
  const { db, settings, notifyDataChanged, dataVersion } = useApp();
  const { push, pop } = useNavigation();
  const { colors } = useTheme();
  const [word, setWord] = useState<Word | null>(null);
  const [history, setHistory] = useState<ReviewLog[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!db) return;
    setLoading(true);
    try {
      const found = await getWord(db, id);
      setWord(found);
      if (found) setHistory(await getWordHistory(db, found.id, 20));
    } finally {
      setLoading(false);
    }
  }, [db, id]);

  useEffect(() => {
    void load();
  }, [load, dataVersion]);

  if (loading) {
    return (
      <Screen scroll={false}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  if (!word) {
    return (
      <Screen>
        <ScreenHeader title="Không tìm thấy từ" onBack={pop} />
        <Banner tone="warning" title="Từ này có thể đã bị xoá" />
        <PrimaryButton label="Quay lại" onPress={pop} />
      </Screen>
    );
  }

  const toggleFavorite = async () => {
    if (!db) return;
    await setFavorite(db, word.id, !word.isFavorite);
    await notifyDataChanged();
    void load();
  };

  const confirmDelete = () => {
    Alert.alert(
      `Xoá "${word.term}"?`,
      'Từ này và toàn bộ lịch sử ôn tập của nó sẽ bị xoá. Không thể hoàn tác.',
      [
        { text: 'Huỷ', style: 'cancel' },
        {
          text: 'Xoá',
          style: 'destructive',
          onPress: async () => {
            if (!db) return;
            await deleteWord(db, word.id);
            await notifyDataChanged();
            pop();
          },
        },
      ],
    );
  };

  return (
    <Screen>
      <ScreenHeader
        title={displayTerm(word.term)}
        subtitle={`${TRACK_LABELS[word.track]} · ${LEVEL_LABELS[word.level]}`}
        onBack={pop}
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={word.isFavorite ? 'Bỏ yêu thích' : 'Thêm yêu thích'}
            onPress={() => void toggleFavorite()}
            style={[styles.star, { backgroundColor: colors.surfaceAlt }]}
          >
            <AppText variant="headline" color={word.isFavorite ? colors.warning : colors.textFaint}>
              {word.isFavorite ? '★' : '☆'}
            </AppText>
          </Pressable>
        }
      />

      <Card style={{ marginBottom: spacing.md }}>
        <View style={styles.pronRow}>
          <View style={{ flex: 1 }}>
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
              <AppText variant="caption" color={colors.textFaint} style={{ marginTop: 2 }}>
                {word.partOfSpeech}
              </AppText>
            ) : null}
          </View>
          <PrimaryButton
            label="Nghe"
            icon="🔊"
            variant="secondary"
            onPress={() => speak(word.term, { accent: settings.ttsAccent })}
            style={{ paddingHorizontal: spacing.lg }}
          />
        </View>

        <AppText variant="title" style={{ marginTop: spacing.lg }}>
          {word.meaningVi}
        </AppText>
        {word.definitionEn ? (
          <AppText variant="body" color={colors.textMuted} style={{ marginTop: spacing.sm }}>
            {word.definitionEn}
          </AppText>
        ) : null}
      </Card>

      {word.exampleEn ? (
        <Card soft style={{ marginBottom: spacing.md }}>
          <View style={styles.exampleHeader}>
            <AppText variant="micro" color={colors.textFaint}>
              VÍ DỤ
            </AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Nghe câu ví dụ"
              onPress={() => speak(word.exampleEn ?? '', { accent: settings.ttsAccent })}
              hitSlop={8}
            >
              <AppText variant="body" color={colors.primary}>
                🔊
              </AppText>
            </Pressable>
          </View>
          <AppText variant="bodyStrong" style={{ marginTop: spacing.xs }}>
            {word.exampleEn}
          </AppText>
          {word.exampleVi ? (
            <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.xs }}>
              {word.exampleVi}
            </AppText>
          ) : null}
        </Card>
      ) : null}

      {word.note ? (
        <Card style={{ marginBottom: spacing.md }}>
          <AppText variant="micro" color={colors.textFaint}>
            GHI CHÚ CÁ NHÂN
          </AppText>
          <AppText variant="body" style={{ marginTop: 2 }}>
            {word.note}
          </AppText>
        </Card>
      ) : null}

      <SectionHeader title="Từ vựng mở rộng" />
      <Card>
        <DetailRow label="Từ đồng nghĩa" value={formatList(word.synonyms)} />
        <DetailRow label="Từ trái nghĩa" value={formatList(word.antonyms)} />
        <DetailRow label="Collocations" value={formatList(word.collocations)} />
        <DetailRow label="Word family" value={formatList(word.wordFamily)} />
        <DetailRow label="Chủ đề" value={word.topic ?? ''} />
        <DetailRow
          label="Nguồn"
          value={
            word.source === 'ai'
              ? word.confirmed
                ? 'AI đề xuất · bạn đã xác nhận'
                : 'AI đề xuất · chưa xác nhận'
              : word.source === 'seed'
                ? 'Bộ từ khởi tạo'
                : word.source === 'import'
                  ? 'Nhập từ file'
                  : word.source === 'dictionary'
                    ? `Tra từ điển${word.dictSource ? ` (${word.dictSource})` : ''}`
                    : 'Tự thêm'
          }
        />
        {word.missingFields && word.missingFields.length > 0 ? (
          <DetailRow
            label="Còn thiếu"
            value={word.missingFields.map((field) => DICT_FIELD_LABELS[field]).join(', ')}
          />
        ) : null}
        <DetailRow label="Ngày thêm" value={new Date(word.createdAt).toLocaleDateString('vi-VN')} />
      </Card>

      <SectionHeader title="Tiến độ ghi nhớ" />
      <Card>
        <View style={styles.statsRow}>
          <MiniStat label="Lần ôn" value={String(word.reps)} />
          <MiniStat label="Số lần quên" value={String(word.lapses)} />
          <MiniStat label="Độ bền" value={word.stability > 0 ? `${word.stability.toFixed(1)}d` : '—'} />
        </View>
        <View style={{ marginTop: spacing.md }}>
          <DetailRow label="Trạng thái" value={stateLabel(word)} />
          <DetailRow label="Ôn tiếp theo" value={formatRelativeDue(word.dueAt)} />
          <DetailRow
            label="Lần ôn gần nhất"
            value={
              word.lastReviewedAt
                ? new Date(word.lastReviewedAt).toLocaleString('vi-VN')
                : 'Chưa ôn lần nào'
            }
          />
        </View>
      </Card>

      <SectionHeader title="Lịch sử ôn tập" />
      {history.length === 0 ? (
        <Card soft>
          <AppText variant="body" color={colors.textMuted}>
            Chưa có lượt ôn nào. Từ này sẽ xuất hiện trong buổi học tiếp theo.
          </AppText>
        </Card>
      ) : (
        <Card>
          {history.map((log, index) => (
            <View
              key={log.id}
              style={[
                styles.historyRow,
                index < history.length - 1 && {
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: colors.border,
                },
              ]}
            >
              <View style={{ flex: 1 }}>
                <AppText variant="caption">
                  {new Date(log.reviewedAt).toLocaleString('vi-VN')}
                </AppText>
                <AppText variant="micro" color={colors.textFaint}>
                  {log.mode.toUpperCase()} · Lịch tới: {log.nextIntervalDays}d
                </AppText>
              </View>
              <AppText variant="caption" color={log.correct ? colors.success : colors.danger}>
                {ratingLabel(log.rating)}
              </AppText>
            </View>
          ))}
        </Card>
      )}

      <View style={styles.buttonRow}>
        <PrimaryButton
          label="Chỉnh sửa"
          variant="secondary"
          style={{ flex: 1 }}
          onPress={() => push({ name: 'wordForm', id: word.id })}
        />
        <PrimaryButton
          label="Xoá"
          variant="ghost"
          style={{ flex: 1 }}
          onPress={confirmDelete}
        />
      </View>
    </Screen>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  if (!value) return null;
  return (
    <View style={styles.detailRow}>
      <AppText variant="caption" color={colors.textMuted} style={{ width: 120 }}>
        {label}
      </AppText>
      <AppText variant="caption" style={{ flex: 1 }}>
        {value}
      </AppText>
    </View>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1 }}>
      <AppText variant="micro" color={colors.textFaint}>
        {label.toUpperCase()}
      </AppText>
      <AppText variant="headline">{value}</AppText>
    </View>
  );
}

function ratingLabel(rating: number): string {
  if (rating === 1) return 'Quên';
  if (rating === 2) return 'Khó';
  if (rating === 3) return 'Nhớ';
  return 'Dễ';
}

function stateLabel(word: Word): string {
  switch (word.learningState) {
    case 'new':
      return 'Từ mới';
    case 'learning':
      return 'Đang học';
    case 'relearning':
      return 'Học lại';
    case 'review':
      return 'Đang ôn';
    case 'known':
      return 'Đã nhớ';
    default:
      return word.learningState;
  }
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  star: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pronRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  exampleHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statsRow: { flexDirection: 'row', gap: spacing.md },
  detailRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: 3 },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  buttonRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xxl },
});

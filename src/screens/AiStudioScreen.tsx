import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText, Banner, Card, PrimaryButton, Screen, SectionHeader } from '../components/ui';
import { Input, LevelPicker, ScreenHeader, Stepper, TrackSwitcher } from '../components/patterns';
import { generateVocabulary } from '../ai/gemini';
import { describeAiError, type AiErrorView } from '../ai/errors';
import type { AiSuggestion } from '../ai/types';
import { DuplicateWordError, createWord, listWords } from '../db/words';
import { formatList, splitList } from '../lib/text';
import { useNavigation } from '../navigation/NavigationProvider';
import { useApp } from '../state/AppProvider';
import { useTheme } from '../theme/ThemeProvider';
import { spacing } from '../theme/tokens';
import type { Level, Track } from '../types';

interface Draft extends AiSuggestion {
  include: boolean;
}

export function AiStudioScreen() {
  const { db, settings, notifyDataChanged, updateSettings } = useApp();
  const { pop, goToTab } = useNavigation();
  const { colors } = useTheme();

  const [track, setTrack] = useState<Track>(settings.track);
  const [level, setLevel] = useState<Level>(settings.level);
  const [topic, setTopic] = useState('');
  const [focus, setFocus] = useState('');
  const [count, setCount] = useState(8);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<AiErrorView | null>(null);
  const [modelNote, setModelNote] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [requestedCount, setRequestedCount] = useState(0);
  const [editing, setEditing] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Draft | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Leaving the screen cancels the request instead of letting it finish in the
  // background and update a screen the learner can no longer see.
  useEffect(() => () => abortRef.current?.abort(), []);

  const generate = useCallback(async () => {
    if (!db || loading) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    setModelNote(null);
    setRejected([]);
    setWarnings([]);
    setProgress('Đang gửi yêu cầu tới Gemini…');
    try {
      const existing = await listWords(db, { track, limit: 300 });
      const result = await generateVocabulary(
        {
          track,
          level,
          topic: topic.trim() || null,
          count,
          focus: focus.trim() || null,
          avoidTerms: existing.map((word) => word.term),
          weakTerms: existing.filter((word) => word.lapses > 0).slice(0, 20).map((word) => word.term),
        },
        {
          model: settings.aiModel,
          signal: controller.signal,
          onAttempt: (info) => {
            if (controller.signal.aborted) return;
            setProgress(
              info.delayMs !== undefined
                ? `Gemini lỗi tạm thời. Thử lại lần ${info.attempt}/${info.attempts} sau ${(info.delayMs / 1000).toFixed(1)} giây…`
                : info.attempt > 1
                  ? `Đang thử lại (lần ${info.attempt}/${info.attempts})…`
                  : 'Gemini đang tạo từ…',
            );
          },
        },
      );
      if (controller.signal.aborted) return;

      setDrafts(result.suggestions.map((item) => ({ ...item, include: true })));
      setRejected(result.rejected);
      setWarnings(result.warnings);
      setRequestedCount(result.requested);
      if (result.fallbackFrom) {
        setModelNote(
          `Model "${result.fallbackFrom}" đã bị Google ngừng nên lần này dùng "${result.model}". Vào Cài đặt → Gemini AI để lưu model mới.`,
        );
      }
    } catch (caught) {
      if (controller.signal.aborted) return;
      const view = describeAiError(caught);
      setError(view.code === 'cancelled' ? null : view);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setLoading(false);
        setProgress(null);
      }
    }
  }, [db, track, level, topic, focus, count, settings.aiModel, loading]);

  const selectedCount = drafts.filter((draft) => draft.include).length;

  const saveSelected = async () => {
    if (!db || saving) return;
    setSaving(true);
    let added = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const draft of drafts.filter((item) => item.include)) {
      try {
        await createWord(db, {
          term: draft.term,
          ipa: draft.ipa ?? null,
          partOfSpeech: draft.partOfSpeech ?? null,
          meaningVi: draft.meaningVi,
          definitionEn: draft.definitionEn ?? null,
          exampleEn: draft.exampleEn ?? null,
          exampleVi: draft.exampleVi ?? null,
          synonyms: draft.synonyms ?? [],
          antonyms: draft.antonyms ?? [],
          collocations: draft.collocations ?? [],
          wordFamily: draft.wordFamily ?? [],
          topic: draft.topic ?? (topic.trim() || null),
          track: draft.track ?? track,
          level: draft.level ?? level,
          source: 'ai',
          aiGenerated: true,
          confirmed: true,
          note: null,
        });
        added += 1;
      } catch (caught) {
        if (caught instanceof DuplicateWordError) {
          skipped += 1;
        } else {
          errors.push(
            `${draft.term}: ${caught instanceof Error ? caught.message : 'lỗi không rõ'}`,
          );
        }
      }
    }

    await notifyDataChanged();
    setSaving(false);
    setDrafts([]);
    Alert.alert(
      'Đã thêm từ',
      [
        `${added} từ đã được thêm vào bộ ${track === 'ielts' ? 'IELTS' : 'General'}.`,
        skipped > 0 ? `${skipped} từ bị bỏ qua vì đã tồn tại.` : '',
        errors.length > 0 ? `Lỗi: ${errors.slice(0, 3).join('; ')}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      [{ text: 'Xem bộ từ', onPress: () => goToTab('words') }],
    );
  };

  const openEdit = (index: number) => {
    const draft = drafts[index];
    if (!draft) return;
    setEditing(index);
    setEditForm({ ...draft });
  };

  const applyEdit = () => {
    if (editing === null || !editForm) return;
    setDrafts((previous) =>
      previous.map((item, index) => (index === editing ? { ...editForm, include: item.include } : item)),
    );
    setEditing(null);
    setEditForm(null);
  };

  return (
    <Screen>
      <ScreenHeader
        title="Gemini Studio"
        subtitle="Gợi ý bộ từ theo đúng cấp độ và chủ đề"
        onBack={pop}
      />

      <Banner
        tone="info"
        title="Bạn kiểm soát mọi thứ trước khi lưu"
        body="Gemini chỉ đề xuất. Ứng dụng chưa lưu gì cho tới khi bạn chọn từ và bấm thêm. Hãy đọc lại nghĩa và ví dụ."
      />

      <Card>
        <TrackSwitcher
          value={track}
          onChange={(next) => {
            setTrack(next);
            void updateSettings({ track: next });
          }}
        />
        <AppText variant="caption" color={colors.textMuted} style={{ marginBottom: spacing.xs }}>
          Cấp độ
        </AppText>
        <LevelPicker value={level} onChange={setLevel} />

        <View style={{ height: spacing.md }} />
        <AppText variant="caption" color={colors.textMuted}>
          Chủ đề (để trống nếu muốn Gemini tự chọn)
        </AppText>
        <Input
          value={topic}
          onChangeText={setTopic}
          placeholder="Work, Environment, Daily life…"
          autoCapitalize="sentences"
          style={{ marginTop: spacing.xs, marginBottom: spacing.md }}
        />

        <AppText variant="caption" color={colors.textMuted}>
          Ưu tiên đặc biệt (tuỳ chọn)
        </AppText>
        <Input
          value={focus}
          onChangeText={setFocus}
          placeholder="ví dụ: collocations for IELTS Writing Task 2"
          autoCapitalize="sentences"
          style={{ marginTop: spacing.xs, marginBottom: spacing.md }}
        />

        <Stepper
          label="Số từ cần tạo"
          value={count}
          min={3}
          max={20}
          step={1}
          suffix="từ"
          onChange={setCount}
        />

        <PrimaryButton
          label={loading ? 'Gemini đang tạo…' : '✨ Tạo bộ từ'}
          onPress={() => void generate()}
          loading={loading}
          disabled={loading}
          style={{ marginTop: spacing.md }}
        />
        {loading && progress ? (
          <AppText
            variant="caption"
            color={colors.textMuted}
            style={{ marginTop: spacing.sm, textAlign: 'center' }}
          >
            {progress}
          </AppText>
        ) : null}
      </Card>

      {error ? (
        <View style={{ marginTop: spacing.md }}>
          <Banner
            tone="danger"
            title={error.title}
            body={`${error.body}${error.hint ? `\n${error.hint}` : ''}\nHọc và ôn tập offline vẫn hoạt động bình thường.`}
          />
          <AppText variant="micro" color={colors.textFaint} style={{ marginTop: spacing.xs }}>
            Kỹ thuật: {error.diagnostic}
          </AppText>
          <View style={styles.errorActions}>
            {error.canRetry ? (
              <PrimaryButton
                label="Thử lại"
                variant="ghost"
                style={{ flex: 1 }}
                disabled={loading}
                onPress={() => void generate()}
              />
            ) : null}
            {error.code === 'invalid_key' ||
            error.code === 'missing_key' ||
            error.code === 'model_unavailable' ||
            error.code === 'quota_exceeded' ? (
              <PrimaryButton
                label="Mở Cài đặt"
                style={{ flex: 1 }}
                onPress={() => goToTab('settings')}
              />
            ) : null}
          </View>
        </View>
      ) : null}

      {drafts.length > 0 && requestedCount > drafts.length ? (
        <View style={{ marginTop: spacing.md }}>
          <Banner
            tone="warning"
            title={`Thiếu ${requestedCount - drafts.length} từ`}
            body={`Bạn yêu cầu ${requestedCount} từ, Gemini trả về ${drafts.length} từ dùng được. Bấm "Tạo bộ từ" lần nữa để xin thêm, hoặc thêm tay bằng nút + ở tab Từ vựng.`}
          />
        </View>
      ) : null}

      {warnings.length > 0 ? (
        <View style={{ marginTop: spacing.md }}>
          <Banner
            tone="warning"
            title={`${warnings.length} điểm cần kiểm tra`}
            body={warnings.slice(0, 3).join(' ')}
          />
        </View>
      ) : null}

      {modelNote ? (
        <View style={{ marginTop: spacing.md }}>
          <Banner tone="warning" title="Đã tự đổi model Gemini" body={modelNote} />
        </View>
      ) : null}

      {rejected.length > 0 ? (
        <View style={{ marginTop: spacing.md }}>
          <Banner
            tone="warning"
            title={`${rejected.length} mục bị loại`}
            body={rejected.slice(0, 3).join(' ')}
          />
        </View>
      ) : null}

      {drafts.length > 0 ? (
        <>
          <SectionHeader title={`${selectedCount}/${drafts.length} từ sẽ thêm`} />
          {drafts.map((draft, index) => (
            <Card key={`${draft.term}-${index}`} style={{ marginBottom: spacing.md }}>
              <View style={styles.draftHeader}>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: draft.include }}
                  onPress={() =>
                    setDrafts((previous) =>
                      previous.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, include: !item.include } : item,
                      ),
                    )
                  }
                  style={[
                    styles.checkbox,
                    {
                      borderColor: draft.include ? colors.primary : colors.border,
                      backgroundColor: draft.include ? colors.primary : 'transparent',
                    },
                  ]}
                >
                  {draft.include ? (
                    <AppText variant="caption" color={colors.onPrimary}>
                      ✓
                    </AppText>
                  ) : null}
                </Pressable>
                <View style={{ flex: 1 }}>
                  <AppText variant="headline">{draft.term}</AppText>
                  {draft.ipa ? (
                    <AppText variant="caption" color={colors.textFaint}>
                      {draft.ipa}
                    </AppText>
                  ) : null}
                </View>
                <Pressable onPress={() => openEdit(index)} accessibilityRole="button">
                  <AppText variant="caption" color={colors.primary}>
                    Sửa
                  </AppText>
                </Pressable>
              </View>

              <AppText variant="body" color={colors.textMuted} style={{ marginTop: spacing.sm }}>
                {draft.meaningVi}
              </AppText>
              {draft.exampleEn ? (
                <AppText variant="caption" color={colors.textFaint} style={{ marginTop: spacing.xs }}>
                  {draft.exampleEn}
                </AppText>
              ) : null}
              <View style={styles.draftMeta}>
                <AppText variant="micro" color={colors.textFaint}>
                  {(draft.partOfSpeech ?? 'phrase').toUpperCase()} · {draft.topic ?? topic ?? 'GENERAL'}
                </AppText>
                {draft.rationale ? (
                  <AppText variant="micro" color={colors.warning}>
                    {draft.rationale}
                  </AppText>
                ) : null}
              </View>
            </Card>
          ))}

          <PrimaryButton
            label={`Thêm ${selectedCount} từ đã chọn`}
            onPress={() => void saveSelected()}
            loading={saving}
            disabled={saving || selectedCount === 0}
          />
          <AppText
            variant="caption"
            color={colors.textFaint}
            style={{ marginTop: spacing.sm, textAlign: 'center' }}
          >
            Từ đã thêm được đánh dấu nguồn AI và bạn đã xác nhận nội dung.
          </AppText>
        </>
      ) : null}

      <Modal visible={editing !== null} animationType="slide" presentationStyle="pageSheet">
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing.huge }}>
            <AppText variant="title">Sửa từ trước khi thêm</AppText>
            {editForm ? (
              <View style={{ marginTop: spacing.lg }}>
                {(
                  [
                    ['term', 'Từ tiếng Anh'],
                    ['ipa', 'Phiên âm IPA'],
                    ['partOfSpeech', 'Từ loại'],
                    ['meaningVi', 'Nghĩa tiếng Việt'],
                    ['definitionEn', 'Định nghĩa tiếng Anh'],
                    ['exampleEn', 'Ví dụ tiếng Anh'],
                    ['exampleVi', 'Bản dịch ví dụ'],
                    ['topic', 'Chủ đề'],
                  ] as const
                ).map(([key, label]) => (
                  <View key={key} style={{ marginBottom: spacing.md }}>
                    <AppText variant="caption" color={colors.textMuted}>
                      {label}
                    </AppText>
                    <Input
                      value={String(editForm[key] ?? '')}
                      onChangeText={(value) =>
                        setEditForm((previous) =>
                          previous ? ({ ...previous, [key]: value } as Draft) : previous,
                        )
                      }
                      multiline={key === 'definitionEn' || key === 'exampleEn'}
                      autoCapitalize="sentences"
                      style={{ marginTop: spacing.xs }}
                    />
                  </View>
                ))}
                <AppText variant="caption" color={colors.textMuted}>
                  Collocations (cách nhau bằng dấu phẩy)
                </AppText>
                <Input
                  value={formatList(editForm.collocations)}
                  onChangeText={(value) =>
                    setEditForm((previous) =>
                      previous ? { ...previous, collocations: splitList(value) } : previous,
                    )
                  }
                  style={{ marginTop: spacing.xs }}
                />
                <PrimaryButton label="Lưu thay đổi" onPress={applyEdit} style={{ marginTop: spacing.lg }} />
                <PrimaryButton
                  label="Đóng"
                  variant="ghost"
                  onPress={() => {
                    setEditing(null);
                    setEditForm(null);
                  }}
                  style={{ marginTop: spacing.sm }}
                />
              </View>
            ) : null}
          </ScrollView>
        </View>
      </Modal>

      <AppText
        variant="caption"
        color={colors.textFaint}
        style={{ marginTop: spacing.xxl, textAlign: 'center' }}
      >
        Gemini có hạn mức miễn phí theo model và theo ngày; hạn mức có thể thay đổi. Kiểm tra
        ai.google.dev để biết giới hạn hiện hành. Ứng dụng không gọi Gemini khi bạn học hay ôn tập.
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  draftHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  draftMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.sm,
    flexWrap: 'wrap',
  },
});

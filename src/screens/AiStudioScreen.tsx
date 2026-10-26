import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText, Banner, Card, Chip, PrimaryButton, Screen, SectionHeader } from '../components/ui';
import { ChipRow, Input, LevelPicker, ScreenHeader, Stepper, TrackSwitcher } from '../components/patterns';
import { generateVocabulary } from '../ai';
import { providerLabel } from '../ai/provider';
import { describeAiError, type AiErrorView } from '../ai/errors';
import type { AiSuggestion } from '../ai/types';
import { DuplicateWordError, createWord, getAllWords } from '../db/words';
import { entryToWordInput, type ListEntry } from '../wordlist/types';
import { formatList, splitList } from '../lib/text';
import { useNavigation } from '../navigation/NavigationProvider';
import { useApp } from '../state/AppProvider';
import { useTheme } from '../theme/ThemeProvider';
import { spacing } from '../theme/tokens';
import { LEVEL_SHORT, type Level, type Track } from '../types';
import { useWordListImport } from './useWordListImport';

interface Draft extends AiSuggestion {
  include: boolean;
}

type CreationMode = 'ai' | 'list';

export function AiStudioScreen() {
  const { db, settings, notifyDataChanged, updateSettings } = useApp();
  const { pop, goToTab } = useNavigation();
  const { colors } = useTheme();

  const [mode, setMode] = useState<CreationMode>('ai');
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
  const [elapsed, setElapsed] = useState(0);
  const [requestedCount, setRequestedCount] = useState(0);
  const [editing, setEditing] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Draft | null>(null);
  const [listSaving, setListSaving] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const providerName = providerLabel(settings.aiProvider);
  const providerModel = settings.aiProvider === 'groq' ? settings.groqModel : settings.aiModel;
  const modeCopy: Record<CreationMode, { label: string; caption: string }> = {
    ai: {
      label: `${providerName} chọn từ`,
      caption: `${providerName} đề xuất từ theo cấp độ và chủ đề; bạn đọc lại rồi mới lưu.`,
    },
    list: {
      label: 'Nhập danh sách từ / cụm từ',
      caption: 'Groq viết nghĩa cho đúng từng mục, kể cả cụm động từ, thành ngữ và collocation.',
    },
  };

  const wordList = useWordListImport({
    db,
    track,
    level,
    topic,
    // Pasted lists always go to Groq: it handles multi-word items, while the
    // old single-word dictionary pipeline rejected them before they were saved.
    model: settings.groqModel,
  });

  // Leaving the screen cancels the request instead of letting it finish in the
  // background and update a screen the learner can no longer see.
  useEffect(() => () => abortRef.current?.abort(), []);

  // A visible second counter: a long call should look busy, not frozen.
  useEffect(() => {
    if (!loading) {
      setElapsed(0);
      return;
    }
    const startedAt = Date.now();
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [loading]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
    setProgress(null);
  }, []);

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
    setProgress(`Đang gửi yêu cầu tới ${providerName}…`);
    try {
      // The whole bank, not a 300-row page: the model must not propose a word
      // that is already somewhere deep in the learner's collection.
      const existing = (await getAllWords(db)).filter((word) => word.track === track);
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
          provider: settings.aiProvider,
          model: providerModel,
          signal: controller.signal,
          onAttempt: (info) => {
            if (controller.signal.aborted) return;
            setProgress(
              info.delayMs !== undefined
                ? `${providerName} lỗi tạm thời. Thử lại lần ${info.attempt}/${info.attempts} sau ${(info.delayMs / 1000).toFixed(1)} giây…`
                : info.attempt > 1
                  ? `Đang thử lại (lần ${info.attempt}/${info.attempts})…`
                  : `${providerName} đang tạo từ…`,
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
          result.fallbackReason === 'overloaded'
            ? `Model "${result.fallbackFrom}" đang quá tải nên lần này app tự dùng "${result.model}". Cài đặt không bị đổi; nếu lỗi lặp lại, chọn model khác trong Cài đặt → AI.`
            : `Model "${result.fallbackFrom}" đã bị ngừng nên lần này dùng "${result.model}". Vào Cài đặt → AI để lưu model mới.`,
        );
      }
    } catch (caught) {
      if (controller.signal.aborted) return;
      const view = describeAiError(caught, providerName);
      setError(view.code === 'cancelled' ? null : view);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setLoading(false);
        setProgress(null);
      }
    }
  }, [db, track, level, topic, focus, count, settings.aiProvider, providerModel, providerName, loading]);

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

  const saveListEntries = async () => {
    if (!db || listSaving) return;
    setListSaving(true);
    let added = 0;
    let skipped = 0;
    let noMeaning = 0;
    const errors: string[] = [];

    for (const entry of wordList.entries) {
      if (!wordList.selected.has(entry.normalized)) continue;
      // The per-word level wins; the saved settings level is only the fallback
      // for words nobody could rate, and the card above says which is which.
      const input = entryToWordInput(entry, { track, level: settings.level, topic });
      if (!input) {
        noMeaning += 1;
        continue;
      }
      try {
        await createWord(db, input);
        added += 1;
      } catch (caught) {
        if (caught instanceof DuplicateWordError) skipped += 1;
        else {
          errors.push(
            `${entry.term}: ${caught instanceof Error ? caught.message : 'lỗi không rõ'}`,
          );
        }
      }
    }

    await notifyDataChanged();
    setListSaving(false);
    wordList.clear();
    Alert.alert(
      'Đã thêm từ do Groq giải nghĩa',
      [
        `${added} từ đã được thêm vào bộ ${track === 'ielts' ? 'IELTS' : 'General'}.`,
        skipped > 0 ? `${skipped} từ đã tồn tại nên bỏ qua.` : '',
        noMeaning > 0 ? `${noMeaning} từ thiếu nghĩa tiếng Việt nên chưa lưu.` : '',
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

  const readyCount = wordList.entries.filter((entry) => entry.status === 'ready').length;
  const failedCount = wordList.entries.filter((entry) => entry.status === 'failed').length;
  const readyWithLevel = wordList.entries.filter(
    (entry) => entry.status === 'ready' && entry.level !== null,
  ).length;

  return (
    <Screen>
      <ScreenHeader
        title="Tạo bộ từ"
        subtitle="Groq chọn từ hoặc giải nghĩa danh sách của bạn"
        onBack={pop}
      />

      <Banner
        tone="info"
        title="Bạn kiểm soát mọi thứ trước khi lưu"
        body="Groq chỉ điền dữ liệu. Ứng dụng chưa lưu gì cho tới khi bạn chọn từ và bấm thêm. Hãy đọc lại nghĩa và ví dụ, đặc biệt với cụm từ."
      />

      <Card>
        <TrackSwitcher
          value={track}
          onChange={(next) => {
            setTrack(next);
            void updateSettings({ track: next });
          }}
        />
        {mode === 'ai' ? (
          <>
            <AppText
              variant="caption"
              color={colors.textMuted}
              style={{ marginBottom: spacing.xs }}
            >
              Cấp độ
            </AppText>
            <LevelPicker value={level} onChange={setLevel} />
          </>
        ) : (
          <AppText variant="micro" color={colors.textFaint}>
            Cấp độ của từng từ do app tự xác định — bạn không cần chọn mức ở đây.
          </AppText>
        )}

        <View style={{ height: spacing.md }} />
        <AppText variant="caption" color={colors.textMuted}>
          Chủ đề (tuỳ chọn)
        </AppText>
        <Input
          value={topic}
          onChangeText={setTopic}
          placeholder="Work, Environment, Daily life…"
          autoCapitalize="sentences"
          style={{ marginTop: spacing.xs, marginBottom: spacing.md }}
        />

        <View style={styles.modeRow}>
          {(Object.keys(modeCopy) as CreationMode[]).map((key) => {
            const active = mode === key;
            return (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setMode(key)}
                style={[
                  styles.modeButton,
                  {
                    borderColor: active ? colors.primary : colors.border,
                    backgroundColor: active ? colors.primary : 'transparent',
                  },
                ]}
              >
                <AppText
                  variant="caption"
                  color={active ? colors.onPrimary : colors.textMuted}
                  style={{ textAlign: 'center' }}
                >
                  {modeCopy[key].label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
        <AppText variant="micro" color={colors.textFaint} style={{ marginBottom: spacing.md }}>
          {modeCopy[mode].caption}
        </AppText>

        {mode === 'ai' ? (
          <>
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
              label={loading ? `${providerName} đang tạo…` : '✨ Tạo bộ từ'}
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
                {elapsed > 0 ? ` · ${elapsed}s` : ''}
              </AppText>
            ) : null}
            {loading ? (
              <PrimaryButton
                label="Huỷ"
                variant="ghost"
                style={{ marginTop: spacing.sm }}
                onPress={cancel}
              />
            ) : null}
          </>
        ) : (
          <>
            <AppText variant="caption" color={colors.textMuted}>
              Mỗi dòng một mục — tiếng Anh hoặc tiếng Việt, Groq tự dịch
            </AppText>
            <Input
              value={wordList.text}
              onChangeText={wordList.setText}
              placeholder={'criminal\ntake into account\nbảo vệ môi trường\ntrách nhiệm dân sự'}
              multiline
              autoCapitalize="none"
              style={{ marginTop: spacing.xs, minHeight: 96, textAlignVertical: 'top' }}
            />
            <AppText variant="micro" color={colors.textFaint} style={{ marginTop: spacing.xs }}>
              {wordList.parsed.terms.length} mục hợp lệ
              {wordList.vietnameseCount > 0 ? ` · ${wordList.vietnameseCount} mục tiếng Việt sẽ được dịch` : ''}
              {wordList.parsed.dropped.filter((item) => item.reason === 'duplicate').length > 0
                ? ` · bỏ ${wordList.parsed.dropped.filter((item) => item.reason === 'duplicate').length} từ trùng`
                : ''}
              {wordList.parsed.truncated ? ' · chỉ tra 50 từ đầu' : ''}
              {wordList.parsed.terms.length > 0 ? '' : ' · dán danh sách để bắt đầu'}
            </AppText>

            <PrimaryButton
              label={wordList.running ? 'Groq đang xử lý…' : 'Groq giải nghĩa & dịch danh sách'}
              onPress={wordList.lookUp}
              loading={wordList.running}
              disabled={wordList.running || wordList.parsed.terms.length === 0}
              style={{ marginTop: spacing.md }}
            />
            {wordList.running ? (
              <>
                <AppText
                  variant="caption"
                  color={colors.textMuted}
                  style={{ marginTop: spacing.sm, textAlign: 'center' }}
                >
                  {wordList.total > 0 ? `${wordList.done}/${wordList.total} từ` : 'Đang chuẩn bị…'}
                  {wordList.elapsed > 0 ? ` · ${wordList.elapsed}s` : ''}
                </AppText>
                <PrimaryButton
                  label="Huỷ"
                  variant="ghost"
                  style={{ marginTop: spacing.sm }}
                  onPress={wordList.cancel}
                />
              </>
            ) : null}
          </>
        )}
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

      {wordList.error ? (
        <View style={{ marginTop: spacing.md }}>
          <Banner tone="warning" title="Một số từ chưa tra được" body={wordList.error} />
        </View>
      ) : null}

      {mode === 'ai' && drafts.length > 0 && requestedCount > drafts.length ? (
        <View style={{ marginTop: spacing.md }}>
          <Banner
            tone="warning"
            title={`Thiếu ${requestedCount - drafts.length} từ`}
            body={`Bạn yêu cầu ${requestedCount} từ, ${providerName} trả về ${drafts.length} từ dùng được. Bấm "Tạo bộ từ" lần nữa để xin thêm, hoặc thêm tay bằng nút + ở tab Từ vựng.`}
          />
        </View>
      ) : null}

      {mode === 'ai' && warnings.length > 0 ? (
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
          <Banner tone="warning" title={`Đã tự đổi model ${providerName}`} body={modelNote} />
        </View>
      ) : null}

      {mode === 'ai' && rejected.length > 0 ? (
        <View style={{ marginTop: spacing.md }}>
          <Banner
            tone="warning"
            title={`${rejected.length} mục bị loại`}
            body={rejected.slice(0, 3).join(' ')}
          />
        </View>
      ) : null}

      {mode === 'list' && wordList.entries.length > 0 ? (
        <>
          <SectionHeader title={`${wordList.selected.size}/${wordList.entries.length} từ sẽ thêm`} />
          <AppText variant="micro" color={colors.textFaint} style={{ marginBottom: spacing.sm }}>
            Cấp độ do Groq đề xuất cho từng mục: {readyWithLevel}/{readyCount} mục đã xong.
            {wordList.unknownLevels > 0
              ? ` ${wordList.unknownLevels} mục AI chưa gắn cấp độ sẽ tạm dùng ${LEVEL_SHORT[settings.level]} — sửa được trong biểu mẫu.`
              : ''}
          </AppText>
          {wordList.note ? (
            <AppText variant="caption" color={colors.textMuted} style={{ marginBottom: spacing.sm }}>
              {wordList.note}
            </AppText>
          ) : null}
          <Banner
            tone={failedCount > 0 ? 'warning' : 'info'}
            title={`${readyCount} mục sẵn sàng · ${failedCount} mục lỗi`}
            body={
              failedCount > 0
                ? 'Bấm "Thử lại" — chỉ các mục lỗi được gửi lại, các mục đã xong giữ nguyên.'
                : 'Mọi mục đều do Groq viết; không có trường nào được bịa thêm. Bạn vẫn có thể bỏ chọn trước khi lưu.'
            }
          />
          {wordList.entries.map((entry) => (
            <ListEntryCard
              key={entry.normalized}
              entry={entry}
              included={wordList.selected.has(entry.normalized)}
              onToggle={() => wordList.toggle(entry.normalized)}
              onChooseOption={(term) => wordList.chooseOption(entry.normalized, term)}
            />
          ))}
          {failedCount > 0 ? (
            <PrimaryButton
              label={`Thử lại ${failedCount} từ lỗi`}
              variant="ghost"
              onPress={wordList.retryFailed}
              disabled={wordList.running}
              style={{ marginTop: spacing.sm }}
            />
          ) : null}
          <PrimaryButton
            label={`Thêm ${wordList.selected.size} từ đã chọn`}
            onPress={() => void saveListEntries()}
            loading={listSaving}
            disabled={listSaving || wordList.selected.size === 0}
            style={{ marginTop: spacing.sm }}
          />
          <AppText
            variant="caption"
            color={colors.textFaint}
            style={{ marginTop: spacing.sm, textAlign: 'center' }}
          >
            Groq giải nghĩa cả cụm từ như một đơn vị, và dịch mục tiếng Việt thành từ tiếng Anh
            tương ứng (bạn đổi được bản dịch nếu có nhiều cách). Mục nào Groq không trả lời được sẽ hiện
            "lỗi" và không bao giờ bị coi là đã lưu.
          </AppText>
        </>
      ) : null}

      {mode === 'ai' && drafts.length > 0 ? (
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
        {providerName} có hạn mức miễn phí theo model và theo ngày; hạn mức có thể thay đổi vài
        lần mỗi năm. Xem hạn mức hiện hành trong Cài đặt → AI. Ứng dụng không gọi AI khi bạn học
        hay ôn tập.
      </AppText>


    </Screen>
  );
}

const FIELD_LABELS: Record<string, string> = {
  ipa: 'phiên âm',
  audio: 'audio',
  partOfSpeech: 'từ loại',
  meaningVi: 'nghĩa tiếng Việt',
  definitionEn: 'định nghĩa',
  exampleEn: 'ví dụ',
  synonyms: 'đồng nghĩa',
};

function ListEntryCard({
  entry,
  included,
  onToggle,
  onChooseOption,
}: {
  entry: ListEntry;
  included: boolean;
  onToggle: () => void;
  onChooseOption: (term: string) => void;
}) {
  const { colors } = useTheme();
  const selectable = entry.status === 'ready' && Boolean(entry.meaningVi);

  return (
    <Card style={{ marginBottom: spacing.md, opacity: selectable ? 1 : 0.75 }}>
      <View style={styles.draftHeader}>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: included, disabled: !selectable }}
          disabled={!selectable}
          onPress={onToggle}
          style={[
            styles.checkbox,
            {
              borderColor: included ? colors.primary : colors.border,
              backgroundColor: included ? colors.primary : 'transparent',
            },
          ]}
        >
          {included ? (
            <AppText variant="caption" color={colors.onPrimary}>
              ✓
            </AppText>
          ) : null}
        </Pressable>
        <View style={{ flex: 1 }}>
          <AppText variant="headline">{entry.term}</AppText>
          {entry.ipa ? (
            <AppText variant="caption" color={colors.textFaint}>
              {entry.ipa}
            </AppText>
          ) : null}
        </View>
        {entry.cached ? (
          <AppText variant="micro" color={colors.textFaint}>
            đã lưu
          </AppText>
        ) : null}
      </View>

      {entry.status === 'failed' ? (
        <AppText variant="caption" color={colors.warning} style={{ marginTop: spacing.sm }}>
          {entry.error ?? 'Groq chưa xử lý được mục này.'}
        </AppText>
      ) : null}

      {entry.meaningVi ? (
        <AppText variant="body" color={colors.textMuted} style={{ marginTop: spacing.sm }}>
          {entry.meaningVi}
        </AppText>
      ) : null}

      {entry.definitionEn ? (
        <AppText variant="caption" color={colors.textFaint} style={{ marginTop: spacing.xs }}>
          {entry.definitionEn}
        </AppText>
      ) : null}
      {entry.exampleEn ? (
        <AppText variant="caption" color={colors.textFaint} style={{ marginTop: spacing.xs }}>
          “{entry.exampleEn}”
        </AppText>
      ) : null}

      {entry.sourceTerm ? (
        <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.xs }}>
          Tiếng Việt gốc: “{entry.sourceTerm}”
          {entry.uncertain ? ' · Groq chưa chắc bản dịch này' : ''}
        </AppText>
      ) : null}
      {entry.englishOptions.length > 1 ? (
        <>
          <AppText variant="micro" color={colors.textFaint} style={{ marginTop: spacing.xs }}>
            Cách dịch khác
          </AppText>
          <ChipRow>
            {entry.englishOptions.map((option) => (
              <Chip
                key={option}
                label={option}
                active={option === entry.term}
                onPress={() => onChooseOption(option)}
              />
            ))}
          </ChipRow>
        </>
      ) : null}

      <View style={styles.draftMeta}>
        <AppText variant="micro" color={colors.textFaint}>
          {entry.level !== null
            ? `${LEVEL_SHORT[entry.level]} · ${entry.levelSource === 'pack' ? 'cấp độ có sẵn' : 'AI ước lượng'}`
            : 'chưa rõ cấp độ'}
        </AppText>
        <AppText variant="micro" color={colors.textFaint}>
          {(entry.partOfSpeech ?? 'chưa rõ từ loại').toUpperCase()} · Groq
        </AppText>
      </View>
      {entry.missing.length > 0 ? (
        <AppText variant="micro" color={colors.textFaint} style={{ marginTop: spacing.xs }}>
          Thiếu: {entry.missing.map((field) => FIELD_LABELS[field] ?? field).join(', ')}
        </AppText>
      ) : null}
    </Card>
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
  modeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  modeButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: 10,
    borderWidth: 1.5,
  },
});

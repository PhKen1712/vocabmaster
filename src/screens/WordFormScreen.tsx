import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Switch, View } from 'react-native';

import { AppText, Banner, Card, PrimaryButton, Screen } from '../components/ui';
import { Input, LevelPicker, ScreenHeader, TrackSwitcher } from '../components/patterns';
import { DuplicateWordError, createWord, getWord, updateWord } from '../db/words';
import { generateVocabulary } from '../ai/gemini';
import { AiError, AI_ERROR_MESSAGES } from '../ai/types';
import { formatList, splitList } from '../lib/text';
import { useNavigation } from '../navigation/NavigationProvider';
import { useApp } from '../state/AppProvider';
import { useTheme } from '../theme/ThemeProvider';
import { spacing } from '../theme/tokens';
import type { Level, Track, WordInput } from '../types';

const PARTS_OF_SPEECH = ['noun', 'verb', 'adjective', 'adverb', 'phrase', 'idiom', 'phrasal verb'];

interface FormState {
  term: string;
  ipa: string;
  partOfSpeech: string;
  meaningVi: string;
  definitionEn: string;
  exampleEn: string;
  exampleVi: string;
  synonyms: string;
  antonyms: string;
  collocations: string;
  wordFamily: string;
  topic: string;
  track: Track;
  level: Level;
  note: string;
  isFavorite: boolean;
}

export function WordFormScreen({ id, draft }: { id?: string; draft?: WordInput }) {
  const { db, settings, notifyDataChanged } = useApp();
  const { pop, push } = useNavigation();
  const { colors } = useTheme();

  const [form, setForm] = useState<FormState>({
    term: draft?.term ?? '',
    ipa: draft?.ipa ?? '',
    partOfSpeech: draft?.partOfSpeech ?? '',
    meaningVi: draft?.meaningVi ?? '',
    definitionEn: draft?.definitionEn ?? '',
    exampleEn: draft?.exampleEn ?? '',
    exampleVi: draft?.exampleVi ?? '',
    synonyms: formatList(draft?.synonyms),
    antonyms: formatList(draft?.antonyms),
    collocations: formatList(draft?.collocations),
    wordFamily: formatList(draft?.wordFamily),
    topic: draft?.topic ?? '',
    track: draft?.track ?? settings.track,
    level: draft?.level ?? settings.level,
    note: draft?.note ?? '',
    isFavorite: draft?.isFavorite ?? false,
  });
  const [loading, setLoading] = useState(Boolean(id));
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiFilled, setAiFilled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !db) return;
    let cancelled = false;
    (async () => {
      try {
        const word = await getWord(db, id);
        if (!word || cancelled) return;
        setForm({
          term: word.term,
          ipa: word.ipa ?? '',
          partOfSpeech: word.partOfSpeech ?? '',
          meaningVi: word.meaningVi,
          definitionEn: word.definitionEn ?? '',
          exampleEn: word.exampleEn ?? '',
          exampleVi: word.exampleVi ?? '',
          synonyms: formatList(word.synonyms),
          antonyms: formatList(word.antonyms),
          collocations: formatList(word.collocations),
          wordFamily: formatList(word.wordFamily),
          topic: word.topic ?? '',
          track: word.track,
          level: word.level,
          note: word.note ?? '',
          isFavorite: word.isFavorite,
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, id]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  const suggestWithAi = async () => {
    if (!form.term.trim()) {
      setError('Nhập từ tiếng Anh trước, rồi bấm gợi ý.');
      return;
    }
    setError(null);
    setAiLoading(true);
    try {
      const result = await generateVocabulary(
        {
          track: form.track,
          level: form.level,
          count: 1,
          topic: form.topic || null,
          lookupTerm: form.term.trim(),
          avoidTerms: [],
          weakTerms: [],
        },
        settings.aiModel,
      );
      const suggestion =
        result.suggestions.find(
          (item) => item.term.trim().toLowerCase() === form.term.trim().toLowerCase(),
        ) ?? result.suggestions[0];
      if (!suggestion) {
        setError(
          result.rejected[0] ??
            'Gemini không trả về nội dung dùng được. Bạn vẫn có thể tự điền các trường.',
        );
        return;
      }
      setForm((previous) => ({
        ...previous,
        term: suggestion.term || previous.term,
        ipa: suggestion.ipa ?? previous.ipa,
        partOfSpeech: suggestion.partOfSpeech ?? previous.partOfSpeech,
        meaningVi: suggestion.meaningVi || previous.meaningVi,
        definitionEn: suggestion.definitionEn ?? previous.definitionEn,
        exampleEn: suggestion.exampleEn ?? previous.exampleEn,
        exampleVi: suggestion.exampleVi ?? previous.exampleVi,
        synonyms: formatList(suggestion.synonyms),
        antonyms: formatList(suggestion.antonyms),
        collocations: formatList(suggestion.collocations),
        wordFamily: formatList(suggestion.wordFamily),
        topic: suggestion.topic ?? previous.topic,
        level: suggestion.level ?? previous.level,
      }));
      setAiFilled(true);
    } catch (caught) {
      setError(
        caught instanceof AiError
          ? AI_ERROR_MESSAGES[caught.code]
          : caught instanceof Error
            ? caught.message
            : 'Không gọi được Gemini.',
      );
    } finally {
      setAiLoading(false);
    }
  };

  const save = async () => {
    if (!db || saving) return;
    setError(null);
    if (!form.term.trim()) {
      setError('Từ tiếng Anh không được để trống.');
      return;
    }
    if (!form.meaningVi.trim()) {
      setError('Nghĩa tiếng Việt không được để trống.');
      return;
    }

    setSaving(true);
    try {
      const payload: WordInput = {
        term: form.term,
        ipa: form.ipa || null,
        partOfSpeech: form.partOfSpeech || null,
        meaningVi: form.meaningVi,
        definitionEn: form.definitionEn || null,
        exampleEn: form.exampleEn || null,
        exampleVi: form.exampleVi || null,
        synonyms: splitList(form.synonyms),
        antonyms: splitList(form.antonyms),
        collocations: splitList(form.collocations),
        wordFamily: splitList(form.wordFamily),
        topic: form.topic || null,
        track: form.track,
        level: form.level,
        note: form.note || null,
        isFavorite: form.isFavorite,
        aiGenerated: aiFilled || undefined,
        confirmed: true,
      };

      if (id) {
        await updateWord(db, id, payload);
      } else {
        await createWord(db, payload);
      }
      await notifyDataChanged();
      pop();
    } catch (caught) {
      if (caught instanceof DuplicateWordError) {
        Alert.alert('Từ đã tồn tại', caught.message, [
          { text: 'Ở lại', style: 'cancel' },
          {
            text: 'Mở từ đã có',
            onPress: () => push({ name: 'word', id: caught.existing.id }),
          },
        ]);
      } else {
        setError(caught instanceof Error ? caught.message : 'Không lưu được từ.');
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Screen scroll={false}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader
        title={id ? 'Sửa từ vựng' : 'Thêm từ vựng'}
        subtitle="Các trường không bắt buộc có thể để trống"
        onBack={pop}
      />

      {error ? <Banner tone="danger" title="Chưa lưu được" body={error} /> : null}
      {aiFilled ? (
        <Banner
          tone="warning"
          title="Nội dung do Gemini gợi ý"
          body="Hãy kiểm tra phiên âm, nghĩa và ví dụ trước khi lưu. Bạn có thể sửa mọi trường."
        />
      ) : null}

      <Card>
        <AppText variant="caption" color={colors.textMuted}>
          Từ tiếng Anh *
        </AppText>
        <Input
          value={form.term}
          onChangeText={(value) => update('term', value)}
          placeholder="ví dụ: borrow hoặc get along with"
          autoCapitalize="none"
          style={{ marginTop: spacing.xs, marginBottom: spacing.md }}
        />
        {!id ? (
          <PrimaryButton
            label={aiLoading ? 'Đang hỏi Gemini…' : '✨ Gợi ý phiên âm, nghĩa, ví dụ'}
            variant="ghost"
            onPress={() => void suggestWithAi()}
            loading={aiLoading}
            disabled={aiLoading}
          />
        ) : null}

        <View style={{ height: spacing.md }} />
        <AppText variant="caption" color={colors.textMuted}>
          Nghĩa tiếng Việt *
        </AppText>
        <Input
          value={form.meaningVi}
          onChangeText={(value) => update('meaningVi', value)}
          placeholder="ví dụ: mượn"
          autoCapitalize="sentences"
          style={{ marginTop: spacing.xs, marginBottom: spacing.md }}
        />

        <AppText variant="caption" color={colors.textMuted}>
          Phiên âm IPA
        </AppText>
        <Input
          value={form.ipa}
          onChangeText={(value) => update('ipa', value)}
          placeholder="/ˈbɒrəʊ/"
          style={{ marginTop: spacing.xs, marginBottom: spacing.md }}
        />

        <AppText variant="caption" color={colors.textMuted}>
          Từ loại
        </AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs }}>
          {PARTS_OF_SPEECH.map((pos) => {
            const active = form.partOfSpeech === pos;
            return (
              <PrimaryButton
                key={pos}
                label={pos}
                variant={active ? 'secondary' : 'ghost'}
                onPress={() => update('partOfSpeech', active ? '' : pos)}
                style={styles.chipButton}
              />
            );
          })}
        </View>

        <View style={{ height: spacing.lg }} />
        <AppText variant="caption" color={colors.textMuted}>
          Định nghĩa tiếng Anh
        </AppText>
        <Input
          value={form.definitionEn}
          onChangeText={(value) => update('definitionEn', value)}
          placeholder="to take something and return it later"
          autoCapitalize="sentences"
          multiline
          style={{ marginTop: spacing.xs, marginBottom: spacing.md }}
        />

        <AppText variant="caption" color={colors.textMuted}>
          Ví dụ tiếng Anh
        </AppText>
        <Input
          value={form.exampleEn}
          onChangeText={(value) => update('exampleEn', value)}
          placeholder="Can I borrow your pen?"
          autoCapitalize="sentences"
          multiline
          style={{ marginTop: spacing.xs, marginBottom: spacing.md }}
        />

        <AppText variant="caption" color={colors.textMuted}>
          Bản dịch ví dụ
        </AppText>
        <Input
          value={form.exampleVi}
          onChangeText={(value) => update('exampleVi', value)}
          placeholder="Tôi mượn bút của bạn được không?"
          autoCapitalize="sentences"
          multiline
          style={{ marginTop: spacing.xs, marginBottom: spacing.md }}
        />

        <AppText variant="caption" color={colors.textMuted}>
          Từ đồng nghĩa · cách nhau bằng dấu phẩy
        </AppText>
        <Input
          value={form.synonyms}
          onChangeText={(value) => update('synonyms', value)}
          placeholder="take on loan"
          style={{ marginTop: spacing.xs, marginBottom: spacing.md }}
        />

        <AppText variant="caption" color={colors.textMuted}>
          Từ trái nghĩa
        </AppText>
        <Input
          value={form.antonyms}
          onChangeText={(value) => update('antonyms', value)}
          placeholder="lend"
          style={{ marginTop: spacing.xs, marginBottom: spacing.md }}
        />

        <AppText variant="caption" color={colors.textMuted}>
          Collocations
        </AppText>
        <Input
          value={form.collocations}
          onChangeText={(value) => update('collocations', value)}
          placeholder="borrow money, borrow a book"
          style={{ marginTop: spacing.xs, marginBottom: spacing.md }}
        />

        <AppText variant="caption" color={colors.textMuted}>
          Word family
        </AppText>
        <Input
          value={form.wordFamily}
          onChangeText={(value) => update('wordFamily', value)}
          placeholder="borrower, borrowing"
          style={{ marginTop: spacing.xs, marginBottom: spacing.md }}
        />

        <AppText variant="caption" color={colors.textMuted}>
          Chủ đề
        </AppText>
        <Input
          value={form.topic}
          onChangeText={(value) => update('topic', value)}
          placeholder="Daily life, Work, Environment…"
          autoCapitalize="sentences"
          style={{ marginTop: spacing.xs, marginBottom: spacing.md }}
        />

        <AppText variant="caption" color={colors.textMuted}>
          Ghi chú cá nhân
        </AppText>
        <Input
          value={form.note}
          onChangeText={(value) => update('note', value)}
          placeholder="Mẹo nhớ, lỗi thường gặp…"
          autoCapitalize="sentences"
          multiline
          style={{ marginTop: spacing.xs, marginBottom: spacing.md }}
        />

        <AppText variant="caption" color={colors.textMuted} style={{ marginBottom: spacing.xs }}>
          Hệ thống học
        </AppText>
        <TrackSwitcher value={form.track} onChange={(track) => update('track', track)} />

        <AppText variant="caption" color={colors.textMuted} style={{ marginBottom: spacing.xs }}>
          Cấp độ
        </AppText>
        <LevelPicker value={form.level} onChange={(level) => update('level', level)} />

        <View style={styles.switchRow}>
          <AppText variant="body">Đưa vào bộ yêu thích</AppText>
          <Switch
            value={form.isFavorite}
            onValueChange={(value) => update('isFavorite', value)}
            trackColor={{ true: colors.primary, false: colors.border }}
          />
        </View>
      </Card>

      <PrimaryButton
        label={id ? 'Lưu thay đổi' : 'Thêm vào bộ từ'}
        onPress={() => void save()}
        loading={saving}
        disabled={saving}
        style={{ marginTop: spacing.lg }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  chipButton: { minHeight: 38, paddingHorizontal: spacing.md },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
  },
});

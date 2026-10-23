import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Card, Chip, EmptyState, PrimaryButton, Screen } from '../components/ui';
import { providerLabel } from '../ai/provider';
import { ChipRow, Input, ScreenHeader, TrackSwitcher } from '../components/patterns';
import { WordCard } from '../components/patterns';
import { listWords, setFavorite } from '../db/words';
import { useNavigation } from '../navigation/NavigationProvider';
import { useApp } from '../state/AppProvider';
import { useTheme } from '../theme/ThemeProvider';
import { spacing } from '../theme/tokens';
import { TRACK_LABELS, type Word } from '../types';

type Filter = 'all' | 'favorite' | 'due' | 'new';

export function WordsScreen() {
  const { db, settings, updateSettings, dataVersion, notifyDataChanged } = useApp();
  const { push } = useNavigation();
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [words, setWords] = useState<Word[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(async () => {
    if (!db) return;
    setLoading(true);
    try {
      const rows = await listWords(db, {
        track: settings.track,
        search: debounced || undefined,
        favoriteOnly: filter === 'favorite',
        dueOnly: filter === 'due',
        state: filter === 'new' ? 'new' : undefined,
        sort: debounced ? 'alpha' : 'recent',
        limit: 300,
      });
      setWords(rows);
      const count = await listWords(db, { track: settings.track, limit: 500 });
      setTotal(count.length);
    } finally {
      setLoading(false);
    }
  }, [db, settings.track, debounced, filter]);

  useEffect(() => {
    void load();
  }, [load, dataVersion]);

  const toggleFavorite = async (word: Word) => {
    if (!db) return;
    await setFavorite(db, word.id, !word.isFavorite);
    await notifyDataChanged();
    void load();
  };

  return (
    <Screen>
      <ScreenHeader
        title="Bộ từ vựng"
        subtitle={`${total} từ · ${TRACK_LABELS[settings.track]}`}
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Thêm từ mới"
            onPress={() => push({ name: 'wordForm' })}
            style={[styles.addButton, { backgroundColor: colors.primary }]}
          >
            <AppText variant="headline" color={colors.onPrimary}>
              +
            </AppText>
          </Pressable>
        }
      />

      <TrackSwitcher
        value={settings.track}
        onChange={(track) => void updateSettings({ track })}
      />

      <Input
        value={query}
        onChangeText={setQuery}
        placeholder="Tìm từ, nghĩa hoặc ghi chú…"
        autoCapitalize="none"
      />

      <View style={{ marginTop: spacing.md }}>
        <ChipRow>
          <Chip label="Tất cả" active={filter === 'all'} onPress={() => setFilter('all')} />
          <Chip
            label="Yêu thích"
            active={filter === 'favorite'}
            onPress={() => setFilter('favorite')}
          />
          <Chip
            label="Cần ôn"
            active={filter === 'due'}
            onPress={() => setFilter('due')}
            tone="warning"
          />
          <Chip label="Từ mới" active={filter === 'new'} onPress={() => setFilter('new')} />
        </ChipRow>
      </View>

      <View style={styles.actionsRow}>
        <PrimaryButton
          label="Nhập / xuất dữ liệu"
          variant="ghost"
          style={{ flex: 1 }}
          onPress={() => push({ name: 'settings' })}
        />
        <PrimaryButton
          label={`${providerLabel(settings.aiProvider)} tạo từ`}
          variant="ghost"
          style={{ flex: 1 }}
          onPress={() => push({ name: 'ai' })}
        />
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : words.length === 0 ? (
        query || filter !== 'all' ? (
          <EmptyState
            emoji="🔍"
            title="Không tìm thấy từ phù hợp"
            body="Thử từ khoá khác hoặc bỏ bộ lọc."
            actionLabel="Bỏ bộ lọc"
            onAction={() => {
              setQuery('');
              setFilter('all');
            }}
          />
        ) : (
          <EmptyState
            emoji="📚"
            title="Bộ từ đang trống"
            body={`Thêm từ đầu tiên bằng biểu mẫu hoặc để ${providerLabel(
              settings.aiProvider,
            )} gợi ý theo cấp độ của bạn.`}
            actionLabel="Thêm từ mới"
            onAction={() => push({ name: 'wordForm' })}
          />
        )
      ) : (
        <View style={{ marginTop: spacing.lg }}>
          {words.map((word) => (
            <WordCard
              key={word.id}
              word={word}
              onPress={() => push({ name: 'word', id: word.id })}
              onToggleFavorite={() => void toggleFavorite(word)}
            />
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  addButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionsRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  loading: { paddingVertical: spacing.huge, alignItems: 'center' },
});

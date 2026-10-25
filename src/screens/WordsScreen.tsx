import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { providerLabel } from '../ai/provider';
import {
  AppText,
  Card,
  Chip,
  EmptyState,
  PrimaryButton,
  Screen,
} from '../components/ui';
import { ChipRow, Input, ScreenHeader, TrackSwitcher, WordCard } from '../components/patterns';
import {
  addWordsToAlbum,
  countAlbumWords,
  removeWordsFromAlbum,
} from '../db/album';
import {
  countWords,
  listWordIds,
  listWords,
  setFavorite,
  type WordQuery,
} from '../db/words';
import { useNavigation } from '../navigation/NavigationProvider';
import { useApp } from '../state/AppProvider';
import { useTheme } from '../theme/ThemeProvider';
import { spacing } from '../theme/tokens';
import { LEVEL_SHORT, TRACK_LABELS, type Level, type Word } from '../types';

type StatusFilter = 'all' | 'favorite' | 'due' | 'new' | 'learning' | 'known';
type AlbumFilter = 'all' | 'in' | 'out';

const SORTS: { id: NonNullable<WordQuery['sort']>; label: string }[] = [
  { id: 'recent', label: 'Mới thêm' },
  { id: 'oldest', label: 'Cũ nhất' },
  { id: 'alpha', label: 'A–Z' },
  { id: 'alpha_desc', label: 'Z–A' },
  { id: 'level_asc', label: 'Cấp thấp → cao' },
  { id: 'level_desc', label: 'Cấp cao → thấp' },
  { id: 'wrong', label: 'Hay sai' },
  { id: 'correct', label: 'Hay đúng' },
  { id: 'due', label: 'Đến hạn' },
];

export function WordsScreen() {
  const {
    db,
    settings,
    updateSettings,
    dataVersion,
    notifyDataChanged,
    rescheduleAlbumNotifications,
  } = useApp();
  const { push } = useNavigation();
  const { colors } = useTheme();

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [level, setLevel] = useState<Level | null>(null);
  const [topic, setTopic] = useState<string | null>(null);
  const [albumFilter, setAlbumFilter] = useState<AlbumFilter>('all');
  const [sort, setSort] = useState<NonNullable<WordQuery['sort']>>('recent');
  const [words, setWords] = useState<Word[]>([]);
  const [total, setTotal] = useState(0);
  const [filteredTotal, setFilteredTotal] = useState(0);
  const [albumTotal, setAlbumTotal] = useState(0);
  const [topics, setTopics] = useState<{ topic: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const baseQuery = useMemo<WordQuery>(() => {
    const queryParts: WordQuery = {
      track: settings.track,
      search: debounced || undefined,
      favoriteOnly: status === 'favorite',
      dueOnly: status === 'due',
      state:
        status === 'new' || status === 'learning' || status === 'known' ? status : undefined,
      level: level ?? undefined,
      topic: topic ?? undefined,
      albumOnly: albumFilter === 'in',
      notInAlbum: albumFilter === 'out',
      sort,
    };
    return queryParts;
  }, [settings.track, debounced, status, level, topic, albumFilter, sort]);

  const hasFilter =
    Boolean(debounced) ||
    status !== 'all' ||
    level !== null ||
    topic !== null ||
    albumFilter !== 'all';

  const load = useCallback(async () => {
    if (!db) return;
    setLoading(true);
    try {
      const [rows, allCount, matchingCount, albumCount, allTopics] = await Promise.all([
        listWords(db, { ...baseQuery, limit: 500 }),
        countWords(db, { track: settings.track }),
        countWords(db, baseQuery),
        countAlbumWords(db),
        db.getAllAsync<{ topic: string; count: number }>(
          `SELECT topic, COUNT(*) AS count FROM words
           WHERE track = ? AND topic IS NOT NULL AND topic <> ''
           GROUP BY topic ORDER BY count DESC, topic ASC LIMIT 12;`,
          [settings.track],
        ),
      ]);
      setWords(rows);
      setTotal(allCount);
      setFilteredTotal(matchingCount);
      setAlbumTotal(albumCount);
      setTopics(allTopics);
      if (topic && !allTopics.some((row) => row.topic === topic)) setTopic(null);
    } finally {
      setLoading(false);
    }
  }, [db, baseQuery, settings.track, topic]);

  useEffect(() => {
    void load();
  }, [load, dataVersion]);

  // A selection belongs to the current filter; changing it must not silently
  // act on words the learner can no longer see.
  useEffect(() => {
    setSelected(new Set());
  }, [debounced, status, level, topic, albumFilter, sort, settings.track]);

  const toggleFavorite = async (word: Word) => {
    if (!db) return;
    await setFavorite(db, word.id, !word.isFavorite);
    await notifyDataChanged();
    void load();
  };

  const toggle = (id: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllFiltered = async () => {
    if (!db) return;
    const ids = await listWordIds(db, { ...baseQuery, limit: 5000 });
    setSelected(new Set(ids));
  };

  const bulkAddToAlbum = async () => {
    if (!db || selected.size === 0) return;
    setBusy('add');
    try {
      const added = await addWordsToAlbum(db, [...selected]);
      const already = selected.size - added;
      await notifyDataChanged();
      await rescheduleAlbumNotifications();
      setSelected(new Set());
      setSelecting(false);
      await load();
      Alert.alert(
        'Đã thêm vào Album',
        `${added} từ mới vào Album${already > 0 ? ` · ${already} từ đã có sẵn` : ''}.`,
      );
    } finally {
      setBusy(null);
    }
  };

  const bulkRemoveFromAlbum = async () => {
    if (!db || selected.size === 0) return;
    setBusy('remove');
    try {
      const removed = await removeWordsFromAlbum(db, [...selected]);
      await notifyDataChanged();
      await rescheduleAlbumNotifications();
      setSelected(new Set());
      setSelecting(false);
      await load();
      Alert.alert('Đã xoá khỏi Album', `${removed} từ đã được bỏ khỏi Album.`);
    } finally {
      setBusy(null);
    }
  };

  const headerRight = (
    <View style={styles.headerActions}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Mở Album từ vựng"
        onPress={() => push({ name: 'album' })}
        style={[styles.albumButton, { backgroundColor: colors.surfaceAlt }]}
      >
        <AppText variant="caption" color={colors.primary}>
          Album{albumTotal > 0 ? ` ${albumTotal}` : ''}
        </AppText>
      </Pressable>
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
    </View>
  );

  return (
    <Screen>
      <ScreenHeader
        title="Bộ từ vựng"
        subtitle={`${total} từ · ${TRACK_LABELS[settings.track]}`}
        right={headerRight}
      />

      <TrackSwitcher
        value={settings.track}
        onChange={(track) => void updateSettings({ track })}
      />

      <Input
        value={query}
        onChangeText={setQuery}
        placeholder="Tìm từ, nghĩa, chủ đề hoặc ghi chú…"
        autoCapitalize="none"
      />

      <View style={styles.filterHeader}>
        <AppText variant="micro" color={colors.textFaint}>
          TRẠNG THÁI
        </AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={selecting ? 'Thoát chế độ chọn' : 'Chọn nhiều từ'}
          onPress={() => {
            setSelecting((value) => !value);
            setSelected(new Set());
          }}
        >
          <AppText variant="caption" color={colors.primary}>
            {selecting ? 'Xong' : 'Chọn nhiều'}
          </AppText>
        </Pressable>
      </View>
      <ChipRow>
        <Chip label="Tất cả" active={status === 'all'} onPress={() => setStatus('all')} />
        <Chip
          label="Yêu thích"
          active={status === 'favorite'}
          onPress={() => setStatus('favorite')}
        />
        <Chip
          label="Cần ôn"
          active={status === 'due'}
          tone="warning"
          onPress={() => setStatus('due')}
        />
        <Chip label="Từ mới" active={status === 'new'} onPress={() => setStatus('new')} />
        <Chip
          label="Đang học"
          active={status === 'learning'}
          onPress={() => setStatus('learning')}
        />
        <Chip label="Đã nhớ" active={status === 'known'} onPress={() => setStatus('known')} />
      </ChipRow>

      <ChipRow>
        <Chip
          label="Mọi cấp"
          active={level === null}
          onPress={() => setLevel(null)}
        />
        {([0, 1, 2, 3, 4, 5, 6] as Level[]).map((value) => (
          <Chip
            key={value}
            label={LEVEL_SHORT[value]}
            active={level === value}
            onPress={() => setLevel(level === value ? null : value)}
          />
        ))}
      </ChipRow>

      {topics.length > 0 ? (
        <ChipRow>
          <Chip label="Mọi chủ đề" active={topic === null} onPress={() => setTopic(null)} />
          {topics.map((row) => (
            <Chip
              key={row.topic}
              label={`${row.topic} (${row.count})`}
              active={topic === row.topic}
              onPress={() => setTopic(topic === row.topic ? null : row.topic)}
            />
          ))}
        </ChipRow>
      ) : null}

      <ChipRow>
        <Chip
          label="Mọi nơi"
          active={albumFilter === 'all'}
          onPress={() => setAlbumFilter('all')}
        />
        <Chip
          label="Trong Album"
          active={albumFilter === 'in'}
          onPress={() => setAlbumFilter('in')}
        />
        <Chip
          label="Chưa vào Album"
          active={albumFilter === 'out'}
          onPress={() => setAlbumFilter('out')}
        />
      </ChipRow>

      <AppText variant="micro" color={colors.textFaint} style={{ marginTop: spacing.sm }}>
        SẮP XẾP
      </AppText>
      <ChipRow>
        {SORTS.map((option) => (
          <Chip
            key={option.id}
            label={option.label}
            active={sort === option.id}
            onPress={() => setSort(option.id)}
          />
        ))}
      </ChipRow>

      {selecting ? (
        <Card soft style={{ marginTop: spacing.md }}>
          <View style={styles.selectionHeader}>
            <View style={{ flex: 1 }}>
              <AppText variant="bodyStrong">Đã chọn {selected.size} từ</AppText>
              <AppText variant="caption" color={colors.textMuted}>
                {hasFilter
                  ? `Đang lọc: ${filteredTotal} kết quả. Chọn tất cả chỉ chọn trong phạm vi này.`
                  : `Toàn bộ ngân hàng: ${total} từ.`}
              </AppText>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Bỏ chọn tất cả"
              onPress={() => setSelected(new Set())}
            >
              <AppText variant="caption" color={colors.primary}>
                Bỏ chọn
              </AppText>
            </Pressable>
          </View>
          <PrimaryButton
            label={hasFilter ? `Chọn tất cả ${filteredTotal} kết quả đang lọc` : `Chọn tất cả ${total} từ`}
            variant="ghost"
            onPress={() => void selectAllFiltered()}
            style={{ marginTop: spacing.sm }}
          />
          <View style={styles.actionRow}>
            <PrimaryButton
              label="Thêm vào Album"
              style={{ flex: 1 }}
              loading={busy === 'add'}
              disabled={selected.size === 0 || busy !== null}
              onPress={() => void bulkAddToAlbum()}
            />
            <PrimaryButton
              label="Bỏ khỏi Album"
              variant="secondary"
              style={{ flex: 1 }}
              loading={busy === 'remove'}
              disabled={selected.size === 0 || busy !== null}
              onPress={() => void bulkRemoveFromAlbum()}
            />
          </View>
        </Card>
      ) : null}

      <View style={styles.actionsRow}>
        <PrimaryButton
          label="Nhập / xuất"
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
        <EmptyState
          emoji="🔍"
          title={hasFilter ? 'Không tìm thấy từ phù hợp' : 'Bộ từ đang trống'}
          body={
            hasFilter
              ? 'Thử từ khoá khác hoặc bỏ bộ lọc.'
              : `Thêm từ đầu tiên bằng biểu mẫu hoặc để ${providerLabel(
                  settings.aiProvider,
                )} gợi ý theo cấp độ của bạn.`
          }
          actionLabel={hasFilter ? 'Bỏ bộ lọc' : 'Thêm từ mới'}
          onAction={() => {
            if (hasFilter) {
              setQuery('');
              setStatus('all');
              setLevel(null);
              setTopic(null);
              setAlbumFilter('all');
              return;
            }
            push({ name: 'wordForm' });
          }}
        />
      ) : (
        <View style={{ marginTop: spacing.lg }}>
          {words.map((word) => {
            const checked = selected.has(word.id);
            return (
              <View key={word.id} style={styles.wordWrap}>
                {selecting ? (
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked }}
                    accessibilityLabel={`Chọn ${word.term}`}
                    onPress={() => toggle(word.id)}
                    style={[
                      styles.checkbox,
                      {
                        borderColor: checked ? colors.primary : colors.border,
                        backgroundColor: checked ? colors.primary : 'transparent',
                      },
                    ]}
                  >
                    {checked ? (
                      <AppText variant="caption" color={colors.onPrimary}>
                        ✓
                      </AppText>
                    ) : null}
                  </Pressable>
                ) : null}
                <View style={{ flex: 1 }}>
                  <WordCard
                    word={word}
                    onPress={() => {
                      if (selecting) toggle(word.id);
                      else push({ name: 'word', id: word.id });
                    }}
                    onToggleFavorite={selecting ? undefined : () => void toggleFavorite(word)}
                  />
                </View>
              </View>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  albumButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  selectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  actionRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  actionsRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  loading: { paddingVertical: spacing.huge, alignItems: 'center' },
  wordWrap: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
});

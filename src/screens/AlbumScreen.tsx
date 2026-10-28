import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, View } from 'react-native';

import { Alert } from '../lib/alert';

import { AppText, Card, Chip, EmptyState, PrimaryButton, Screen, SectionHeader } from '../components/ui';
import { ChipRow, Input, ScreenHeader, Stepper } from '../components/patterns';
import {
  countAlbumWords,
  listAlbumTopics,
  listAlbumWords,
  removeWordsFromAlbum,
  type AlbumSort,
} from '../db/album';
import { ALBUM_NOTIFICATION_LIMIT, getScheduledAlbumCount } from '../notifications/album';
import {
  ALBUM_INTERVAL_PRESETS,
  describeAlbumIntervalRisk,
  formatAlbumInterval,
  splitAlbumInterval,
  validateAlbumInterval,
} from '../notifications/interval';
import { displayTerm } from '../lib/text';
import { useNavigation } from '../navigation/NavigationProvider';
import { speak } from '../speech/tts';
import { useApp } from '../state/AppProvider';
import { useTheme } from '../theme/ThemeProvider';
import { spacing } from '../theme/tokens';
import { LEVEL_SHORT, type Level, type Word } from '../types';

const SORTS: { id: AlbumSort; label: string }[] = [
  { id: 'album_recent', label: 'Mới thêm' },
  { id: 'album_oldest', label: 'Cũ nhất' },
  { id: 'alpha', label: 'A–Z' },
  { id: 'level_asc', label: 'Cấp thấp → cao' },
  { id: 'level_desc', label: 'Cấp cao → thấp' },
  { id: 'due', label: 'Đến hạn' },
];

export function AlbumScreen() {
  const { db, settings, updateSettings, dataVersion, rescheduleAlbumNotifications, notifyDataChanged } =
    useApp();
  const { push, pop } = useNavigation();
  const { colors } = useTheme();

  const [words, setWords] = useState<Word[]>([]);
  const [total, setTotal] = useState(0);
  const [topics, setTopics] = useState<{ topic: string; count: number }[]>([]);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [level, setLevel] = useState<Level | null>(null);
  const [topic, setTopic] = useState<string | null>(null);
  const [sort, setSort] = useState<AlbumSort>('album_recent');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  const [scheduledCount, setScheduledCount] = useState<number | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [intervalHoursText, setIntervalHoursText] = useState(() =>
    String(splitAlbumInterval(settings.albumIntervalMinutes).hours),
  );
  const [intervalMinutesText, setIntervalMinutesText] = useState(() =>
    String(splitAlbumInterval(settings.albumIntervalMinutes).minutes),
  );
  const [intervalError, setIntervalError] = useState<string | null>(null);
  const [intervalSaved, setIntervalSaved] = useState(false);
  const lastIntervalRef = useRef(settings.albumIntervalMinutes);

  // Only an external change (a quick preset, settings restored elsewhere)
  // rewrites the fields; text the learner is still typing is never overwritten.
  useEffect(() => {
    if (lastIntervalRef.current === settings.albumIntervalMinutes) return;
    lastIntervalRef.current = settings.albumIntervalMinutes;
    const parts = splitAlbumInterval(settings.albumIntervalMinutes);
    setIntervalHoursText(String(parts.hours));
    setIntervalMinutesText(String(parts.minutes));
    setIntervalError(null);
    setIntervalSaved(false);
  }, [settings.albumIntervalMinutes]);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(async () => {
    if (!db) return;
    setLoading(true);
    try {
      const [rows, count, topicRows, scheduled] = await Promise.all([
        listAlbumWords(db, {
          search: debounced || undefined,
          level: level ?? undefined,
          topic: topic ?? undefined,
          sort,
          limit: 500,
        }),
        countAlbumWords(db),
        listAlbumTopics(db),
        getScheduledAlbumCount(),
      ]);
      setWords(rows);
      setTotal(count);
      setTopics(topicRows);
      setScheduledCount(scheduled);
      if (topic && !topicRows.some((row) => row.topic === topic)) setTopic(null);
    } finally {
      setLoading(false);
    }
  }, [db, debounced, level, topic, sort]);

  useEffect(() => {
    void load();
  }, [load, dataVersion]);

  const toggle = (id: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = (include: boolean) => {
    setSelected(include ? new Set(words.map((word) => word.id)) : new Set());
  };

  const confirmRemove = () => {
    if (!db || selected.size === 0) return;
    Alert.alert(
      `Xoá ${selected.size} từ khỏi Album?`,
      'Từ vẫn còn trong ngân hàng, vẫn giữ lịch sử học và tiến độ ôn. Chỉ mục trong Album bị xoá.',
      [
        { text: 'Huỷ', style: 'cancel' },
        {
          text: 'Xoá khỏi Album',
          style: 'destructive',
          onPress: async () => {
            const removed = await removeWordsFromAlbum(db, [...selected]);
            setSelected(new Set());
            setSelecting(false);
            await notifyDataChanged();
            await rescheduleAlbumNotifications();
            await load();
            Alert.alert('Đã xoá khỏi Album', `${removed} từ đã được bỏ khỏi Album.`);
          },
        },
      ],
    );
  };

  const saveInterval = async () => {
    const result = validateAlbumInterval(intervalHoursText, intervalMinutesText);
    if (!result.ok) {
      setIntervalError(result.error);
      return;
    }
    setIntervalError(null);
    lastIntervalRef.current = result.minutes;
    await updateSettings({ albumIntervalMinutes: result.minutes });
    setIntervalSaved(true);
  };

  const applyPreset = (minutes: number) => {
    const parts = splitAlbumInterval(minutes);
    setIntervalHoursText(String(parts.hours));
    setIntervalMinutesText(String(parts.minutes));
    setIntervalError(null);
    setIntervalSaved(false);
    void updateSettings({ albumIntervalMinutes: minutes });
  };

  const intervalRisk = describeAlbumIntervalRisk(
    settings.albumIntervalMinutes,
    ALBUM_NOTIFICATION_LIMIT,
  );

  const scheduleNow = async () => {
    setScheduling(true);
    try {
      const result = await rescheduleAlbumNotifications();
      await load();
      if (!result) return;
      if (result.reason === 'disabled') {
        Alert.alert('Thông báo đang tắt', 'Bật thông báo Album trước khi lên lịch.');
      } else if (result.reason === 'no-words') {
        Alert.alert('Album đang trống', 'Thêm ít nhất một từ rồi thử lại.');
      } else if (result.reason === 'permission') {
        Alert.alert(
          'Chưa có quyền thông báo',
          'Mở Cài đặt iOS → VocabMaster → Thông báo để cho phép, rồi thử lại.',
        );
      } else {
        Alert.alert(
          `Đã lên ${result.scheduled} thông báo`,
          result.truncated
            ? `Hàng đợi này phủ khoảng ${Math.round(result.coverageHours)} giờ ở chu kỳ ${formatAlbumInterval(settings.albumIntervalMinutes)}. iOS chỉ giữ một số lượng thông báo đang chờ nhất định, nên app lên trước một hàng đợi ngắn và bổ sung mỗi khi bạn mở app.`
            : 'Mỗi thông báo lấy ngẫu nhiên một từ trong Album, ưu tiên từ lâu chưa xuất hiện.',
        );
      }
    } finally {
      setScheduling(false);
    }
  };

  return (
    <Screen>
      <ScreenHeader
        title="Album từ vựng"
        subtitle={`${total} từ · thông báo ngẫu nhiên`}
        onBack={pop}
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Thêm từ từ ngân hàng"
            onPress={() => push({ name: 'words' })}
            style={[styles.addButton, { backgroundColor: colors.primary }]}
          >
            <AppText variant="headline" color={colors.onPrimary}>
              +
            </AppText>
          </Pressable>
        }
      />

      <Card style={{ marginBottom: spacing.lg }}>
        <AppText variant="micro" color={colors.textFaint}>
          THÔNG BÁO NGẪU NHIÊN
        </AppText>
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <AppText variant="bodyStrong">Bật thông báo Album</AppText>
            <AppText variant="caption" color={colors.textMuted}>
              App tự chọn ngẫu nhiên một từ trong toàn bộ Album. Không cần bật cho từng từ.
            </AppText>
          </View>
          <Switch
            value={settings.albumNotifyEnabled}
            onValueChange={(value) => void updateSettings({ albumNotifyEnabled: value })}
          />
        </View>

        <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.md }}>
          Chu kỳ — bạn tự nhập (ví dụ 7 phút, 90 phút, 2 giờ 30 phút)
        </AppText>
        <View style={styles.intervalRow}>
          <Input
            value={intervalHoursText}
            onChangeText={(next) => {
              setIntervalHoursText(next);
              setIntervalError(null);
              setIntervalSaved(false);
            }}
            placeholder="0"
            keyboardType="number-pad"
            maxLength={3}
            style={styles.intervalInput}
          />
          <AppText variant="caption" color={colors.textMuted}>
            giờ
          </AppText>
          <Input
            value={intervalMinutesText}
            onChangeText={(next) => {
              setIntervalMinutesText(next);
              setIntervalError(null);
              setIntervalSaved(false);
            }}
            placeholder="0"
            keyboardType="number-pad"
            maxLength={4}
            style={styles.intervalInput}
          />
          <AppText variant="caption" color={colors.textMuted}>
            phút
          </AppText>
        </View>
        <AppText variant="caption" color={colors.textMuted}>
          Đang dùng: {formatAlbumInterval(settings.albumIntervalMinutes)}
          {intervalSaved ? ' · đã lưu' : ''}
        </AppText>
        {intervalError ? (
          <AppText variant="caption" color={colors.danger} style={{ marginTop: spacing.xs }}>
            {intervalError}
          </AppText>
        ) : null}
        <PrimaryButton
          label="Lưu chu kỳ"
          variant="secondary"
          onPress={() => void saveInterval()}
          style={{ marginTop: spacing.sm, paddingHorizontal: spacing.lg }}
        />
        <AppText variant="caption" color={colors.textFaint} style={{ marginTop: spacing.sm }}>
          Chọn nhanh
        </AppText>
        <ChipRow>
          {ALBUM_INTERVAL_PRESETS.map((minutes) => (
            <Chip
              key={minutes}
              label={formatAlbumInterval(minutes)}
              active={settings.albumIntervalMinutes === minutes}
              onPress={() => applyPreset(minutes)}
            />
          ))}
        </ChipRow>
        {intervalRisk ? (
          <AppText variant="caption" color={colors.warning} style={{ marginTop: spacing.sm }}>
            {intervalRisk}
          </AppText>
        ) : null}

        <Stepper
          label="Giờ bắt đầu"
          value={settings.albumStartHour}
          min={0}
          max={23}
          suffix="giờ"
          onChange={(albumStartHour) => void updateSettings({ albumStartHour })}
        />
        <Stepper
          label="Giờ kết thúc"
          value={settings.albumEndHour}
          min={0}
          max={23}
          suffix="giờ"
          onChange={(albumEndHour) => void updateSettings({ albumEndHour })}
        />
        <AppText variant="caption" color={colors.textFaint}>
          Nếu giờ kết thúc bằng hoặc sớm hơn giờ bắt đầu, app hiểu là gửi cả ngày.
        </AppText>

        <View style={styles.statusRow}>
          <AppText variant="caption" color={colors.textMuted}>
            Đang chờ trên máy: {scheduledCount ?? 0} thông báo
          </AppText>
          <PrimaryButton
            label="Lên lịch lại"
            variant="secondary"
            loading={scheduling}
            onPress={() => void scheduleNow()}
            style={{ paddingHorizontal: spacing.lg }}
          />
        </View>
        <AppText variant="caption" color={colors.textFaint} style={{ marginTop: spacing.sm }}>
          iOS không cho app chạy nền để gửi đúng từng phút và chỉ giữ tối đa 64 thông báo đang
          chờ. App lên trước 48 lượt, rồi bổ sung khi bạn mở app hoặc đổi cài đặt. Focus, chế độ
          tiết kiệm pin và quyền thông báo có thể làm chậm hoặc ẩn thông báo.
        </AppText>
      </Card>

      <SectionHeader
        title="Bộ sưu tập"
        actionLabel={words.length > 0 ? (selecting ? 'Xong' : 'Chọn') : undefined}
        onAction={
          words.length > 0
            ? () => {
                setSelecting((value) => !value);
                setSelected(new Set());
              }
            : undefined
        }
      />

      <Input
        value={query}
        onChangeText={setQuery}
        placeholder="Tìm từ, nghĩa hoặc chủ đề trong Album…"
        autoCapitalize="none"
      />

      <View style={{ marginTop: spacing.md }}>
        <ChipRow>
          <Chip label="Tất cả cấp" active={level === null} onPress={() => setLevel(null)} />
          {([0, 1, 2, 3, 4, 5, 6] as Level[]).map((value) => (
            <Chip
              key={value}
              label={LEVEL_SHORT[value]}
              active={level === value}
              onPress={() => setLevel(level === value ? null : value)}
            />
          ))}
        </ChipRow>
      </View>

      {topics.length > 0 ? (
        <ChipRow>
          <Chip label="Mọi chủ đề" active={topic === null} onPress={() => setTopic(null)} />
          {topics.slice(0, 12).map((row) => (
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
          <AppText variant="bodyStrong">Đã chọn {selected.size} từ</AppText>
          <View style={styles.actionRow}>
            <PrimaryButton
              label="Chọn tất cả"
              variant="ghost"
              style={{ flex: 1 }}
              onPress={() => selectAll(true)}
            />
            <PrimaryButton
              label="Bỏ chọn"
              variant="ghost"
              style={{ flex: 1 }}
              onPress={() => selectAll(false)}
            />
          </View>
          <PrimaryButton
            label={`Xoá ${selected.size} từ khỏi Album`}
            variant="danger"
            disabled={selected.size === 0}
            onPress={confirmRemove}
            style={{ marginTop: spacing.md }}
          />
          <AppText variant="caption" color={colors.textFaint} style={{ marginTop: spacing.xs }}>
            Chỉ xoá khỏi Album. Từ, lịch sử học và xu không bị ảnh hưởng.
          </AppText>
        </Card>
      ) : null}

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : words.length === 0 ? (
        <EmptyState
          emoji="🗂"
          title={total === 0 ? 'Album đang trống' : 'Không có từ phù hợp'}
          body={
            total === 0
              ? 'Mở ngân hàng từ vựng, bấm Chọn, tick nhiều từ rồi thêm vào Album chỉ trong một lần.'
              : 'Thử bỏ bộ lọc hoặc từ khoá khác.'
          }
          actionLabel={total === 0 ? 'Mở ngân hàng từ' : 'Bỏ bộ lọc'}
          onAction={() => {
            if (total === 0) {
              push({ name: 'words' });
              return;
            }
            setQuery('');
            setLevel(null);
            setTopic(null);
          }}
        />
      ) : (
        <View style={{ marginTop: spacing.lg }}>
          {words.map((word) => {
            const checked = selected.has(word.id);
            return (
              <Card
                key={word.id}
                onPress={() => {
                  if (selecting) toggle(word.id);
                  else push({ name: 'word', id: word.id });
                }}
                style={[
                  styles.wordCard,
                  checked && { borderColor: colors.primary, backgroundColor: colors.primarySoft },
                ]}
                accessibilityLabel={`Từ ${word.term}${checked ? ', đã chọn' : ''}`}
              >
                <View style={styles.wordRow}>
                  {selecting ? (
                    <View
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
                    </View>
                  ) : null}
                  <View style={{ flex: 1 }}>
                    <View style={styles.titleRow}>
                      <AppText variant="headline" numberOfLines={1} style={{ flexShrink: 1 }}>
                        {displayTerm(word.term)}
                      </AppText>
                      <AppText variant="micro" color={colors.textFaint} style={{ marginLeft: 6 }}>
                        {LEVEL_SHORT[word.level]}
                      </AppText>
                    </View>
                    <AppText variant="body" color={colors.textMuted} numberOfLines={2}>
                      {word.meaningVi}
                    </AppText>
                    <AppText variant="micro" color={colors.textFaint} style={{ marginTop: 4 }}>
                      {word.topic ?? 'Chưa có chủ đề'} ·{' '}
                      {word.reps === 0 ? 'CHƯA HỌC' : `ĐÃ HỌC ${word.reps} LẦN`}
                    </AppText>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Nghe ${word.term}`}
                    onPress={() => speak(word.term, { accent: settings.ttsAccent })}
                    hitSlop={10}
                    style={styles.speakButton}
                  >
                    <AppText variant="body" color={colors.primary}>
                      🔊
                    </AppText>
                  </Pressable>
                </View>
              </Card>
            );
          })}
        </View>
      )}

      <PrimaryButton
        label="Thêm từ từ ngân hàng"
        variant="secondary"
        onPress={() => push({ name: 'words' })}
        style={{ marginTop: spacing.lg }}
      />
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
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  intervalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
    flexWrap: 'wrap',
  },
  intervalInput: { minWidth: 64 },
  actionRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  loading: { paddingVertical: spacing.huge, alignItems: 'center' },
  wordCard: { marginBottom: spacing.sm },
  wordRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  speakButton: { paddingLeft: spacing.sm, paddingTop: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'baseline' },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
});

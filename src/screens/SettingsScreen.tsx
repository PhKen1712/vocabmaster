import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Switch, View } from 'react-native';

import {
  AppText,
  Banner,
  Card,
  Divider,
  PrimaryButton,
  Screen,
  SectionHeader,
} from '../components/ui';
import { ChipRow, Input, ScreenHeader, Stepper, TrackSwitcher } from '../components/patterns';
import {
  checkProviderKey,
  clearProviderKey,
  hasProviderKey,
  PROVIDER_INFO,
  providerLabel,
  saveProviderKey,
} from '../ai';
import type { KeyCheck } from '../ai/types';
import {
  clearDiagnostics,
  formatDiagnostic,
  getDiagnostics,
  subscribeDiagnostics,
  type AiDiagnostic,
} from '../ai/diagnostics';
import { exportBackupFile, exportCsvFile, importCsvWords, pickTextFile, restoreBackup } from '../db/backup';
import { getCounts } from '../db/words';
import { resetDatabase } from '../db/database';
import { resetStudyProgress } from '../db/reset';
import { newId } from '../lib/ids';
import { playSfx } from '../sound/sfx';
import {
  cancelReminders,
  getNotificationPermission,
  requestNotificationPermission,
  scheduleReminders,
} from '../notifications/reminders';
import { getCoinSummary, listCoinHistory, resetCoins, type CoinSummary } from '../coins/ledger';
import { getRestoreState } from '../db/streakRestore';
import { useMusic } from '../music/MusicProvider';
import { getEnglishVoices, speak, voiceAvailability, type VoiceLike } from '../speech/tts';
import { useApp } from '../state/AppProvider';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/tokens';
import {
  AI_PROVIDERS,
  DEFAULT_AI_MODEL,
  DEFAULT_GROQ_MODEL,
  DEFAULT_REVIEW_INTERVALS,
  MAX_REVIEW_INTERVAL,
  MIN_REVIEW_INTERVAL,
  type AiProvider,
  type CoinEvent,
  type ReviewIntervals,
  type ThemeMode,
  type TtsVoice,
} from '../types';
import { useNavigation } from '../navigation/NavigationProvider';

const WEEKDAYS = [
  { value: 2, label: 'T2' },
  { value: 3, label: 'T3' },
  { value: 4, label: 'T4' },
  { value: 5, label: 'T5' },
  { value: 6, label: 'T6' },
  { value: 7, label: 'T7' },
  { value: 1, label: 'CN' },
];

export function SettingsScreen() {
  const { db, settings, updateSettings, notifyDataChanged, widgetStatus, stats, dataVersion } = useApp();
  const { pop, push } = useNavigation();
  const { colors } = useTheme();
  const music = useMusic();

  const [keyStatus, setKeyStatus] = useState<'loading' | 'missing' | 'saved'>('loading');
  const [keyInput, setKeyInput] = useState('');
  const [keyError, setKeyError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<KeyCheck | null>(null);
  const [notificationStatus, setNotificationStatus] = useState<string>('…');
  const [busy, setBusy] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<AiDiagnostic[]>(() => getDiagnostics());
  const [voices, setVoices] = useState<VoiceLike[]>([]);
  const [coins, setCoins] = useState<CoinSummary | null>(null);
  const [coinHistory, setCoinHistory] = useState<CoinEvent[]>([]);
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);

  // In-memory only: it survives navigation, not an app restart, and never holds
  // the API key or the learner's content.
  useEffect(() => subscribeDiagnostics(() => setDiagnostics(getDiagnostics())), []);

  useEffect(() => {
    void getEnglishVoices().then(setVoices);
  }, []);

  const loadCoins = useCallback(async () => {
    if (!db) return;
    const [summary, history, restore] = await Promise.all([
      getCoinSummary(db),
      listCoinHistory(db, 8),
      getRestoreState(db, settings.dailyGoal),
    ]);
    setCoins(summary);
    setCoinHistory(history);
    setRestoreTarget(
      restore.offer
        ? `${restore.offer.lostDays} ngày · cần ${restore.offer.progressNewWords}/${restore.offer.targetNewWords} từ mới hôm nay`
        : null,
    );
  }, [db, settings.dailyGoal]);

  useEffect(() => {
    void loadCoins();
  }, [loadCoins, dataVersion]);

  // Model Google đề xuất khi model đang cấu hình đã bị ngừng.
  const suggestedModel = checkResult && !checkResult.ok ? checkResult.suggestedModel ?? null : null;

  const provider = settings.aiProvider;
  const providerInfo = PROVIDER_INFO[provider];
  /* Each provider keeps its own model, so switching never overwrites a good one. */
  const modelValue = provider === 'groq' ? settings.groqModel : settings.aiModel;
  const defaultModel = provider === 'groq' ? DEFAULT_GROQ_MODEL : DEFAULT_AI_MODEL;

  const refreshKeyStatus = useCallback(async () => {
    const exists = await hasProviderKey(provider);
    setKeyStatus(exists ? 'saved' : 'missing');
  }, [provider]);

  useEffect(() => {
    void refreshKeyStatus();
    void getNotificationPermission().then((status) => {
      setNotificationStatus(
        status === 'granted'
          ? 'Đã cấp quyền'
          : status === 'denied'
            ? 'Bị từ chối trong Cài đặt iOS'
            : 'Chưa cấp quyền',
      );
    });
  }, [refreshKeyStatus]);

  const switchProvider = async (next: AiProvider) => {
    if (next === provider) return;
    setCheckResult(null);
    setKeyInput('');
    setKeyError(null);
    setKeyStatus('loading');
    await updateSettings({ aiProvider: next });
  };

  const storeKey = async () => {
    setKeyError(null);
    try {
      await saveProviderKey(provider, keyInput);
      setKeyInput('');
      await refreshKeyStatus();
      Alert.alert(
        'Đã lưu API key',
        `Key ${providerInfo.label} được lưu trong Keychain của iPhone và không nằm trong mã nguồn hay file sao lưu.`,
      );
    } catch (error) {
      setKeyError(error instanceof Error ? error.message : 'Không lưu được key.');
    }
  };

  const verifyKey = async (model = modelValue) => {
    setChecking(true);
    setCheckResult(null);
    try {
      setCheckResult(await checkProviderKey(provider, model));
    } catch (error) {
      setCheckResult({
        ok: false,
        detail: error instanceof Error ? error.message : 'Không kiểm tra được key.',
      });
    } finally {
      setChecking(false);
    }
  };

  // One tap instead of making the learner copy a model name by hand.
  const useSuggestedModel = async (model: string) => {
    await updateSettings(provider === 'groq' ? { groqModel: model } : { aiModel: model });
    await verifyKey(model);
  };

  const removeKey = () => {
    Alert.alert(
      `Xoá ${providerInfo.label} API key?`,
      'Bạn vẫn có thể học và ôn tập bình thường.',
      [
        { text: 'Huỷ', style: 'cancel' },
        {
          text: 'Xoá',
          style: 'destructive',
          onPress: async () => {
            await clearProviderKey(provider);
            await refreshKeyStatus();
          },
        },
      ],
    );
  };

  const applyReminders = async (nextSettings = settings) => {
    if (!db) return;
    const counts = await getCounts(db, nextSettings.track);
    if (!nextSettings.remindersEnabled) {
      await cancelReminders();
      setNotificationStatus('Đã tắt nhắc nhở');
      return;
    }
    const granted = await requestNotificationPermission();
    if (!granted) {
      setNotificationStatus('Chưa được cấp quyền');
      Alert.alert(
        'Chưa có quyền thông báo',
        'Mở Cài đặt iOS → VocabMaster → Thông báo để bật nhắc nhở.',
      );
      return;
    }
    const count = await scheduleReminders(nextSettings, counts.due);
    setNotificationStatus(`Đã lên lịch ${count} nhắc nhở mỗi tuần`);
  };

  const toggleWeekday = async (value: number) => {
    const exists = settings.reminderWeekdays.includes(value);
    const nextDays = exists
      ? settings.reminderWeekdays.filter((day) => day !== value)
      : [...settings.reminderWeekdays, value].sort((a, b) => a - b);
    const next = await updateSettings({ reminderWeekdays: nextDays });
    if (next.remindersEnabled) await applyReminders(next);
  };

  const doExportJson = async () => {
    if (!db) return;
    setBusy('json');
    try {
      const result = await exportBackupFile(db);
      if (!result.shared) {
        Alert.alert('Đã tạo file sao lưu', `File nằm trong bộ nhớ tạm: ${result.fileName}`);
      }
    } catch (error) {
      Alert.alert('Không xuất được', error instanceof Error ? error.message : 'Lỗi không rõ.');
    } finally {
      setBusy(null);
    }
  };

  const doExportCsv = async () => {
    if (!db) return;
    setBusy('csv');
    try {
      const result = await exportCsvFile(db);
      if (!result.shared) {
        Alert.alert('Đã tạo file CSV', `File nằm trong bộ nhớ tạm: ${result.fileName}`);
      }
    } catch (error) {
      Alert.alert('Không xuất được', error instanceof Error ? error.message : 'Lỗi không rõ.');
    } finally {
      setBusy(null);
    }
  };

  const doImportJson = async () => {
    if (!db) return;
    try {
      const file = await pickTextFile();
      if (!file) return;
      Alert.alert('Khôi phục dữ liệu', `File: ${file.name}\n\nChọn cách khôi phục:`, [
        { text: 'Huỷ', style: 'cancel' },
        {
          text: 'Gộp thêm',
          onPress: async () => {
            try {
              const summary = await restoreBackup(db, file.content, 'merge');
              await notifyDataChanged();
              Alert.alert(
                'Đã gộp dữ liệu',
                `Thêm ${summary.added} từ, bỏ qua ${summary.skipped}. ${summary.errors.slice(0, 2).join(' ')}`,
              );
            } catch (error) {
              Alert.alert('Không khôi phục được', error instanceof Error ? error.message : 'Lỗi không rõ.');
            }
          },
        },
        {
          text: 'Thay thế toàn bộ',
          style: 'destructive',
          onPress: async () => {
            try {
              const summary = await restoreBackup(db, file.content, 'replace');
              await notifyDataChanged();
              Alert.alert(
                'Đã khôi phục',
                `Thêm ${summary.added} từ, bỏ qua ${summary.skipped}. ${summary.errors.slice(0, 2).join(' ')}`,
              );
            } catch (error) {
              Alert.alert('Không khôi phục được', error instanceof Error ? error.message : 'Lỗi không rõ.');
            }
          },
        },
      ]);
    } catch (error) {
      Alert.alert('Không đọc được file', error instanceof Error ? error.message : 'Lỗi không rõ.');
    }
  };

  const doImportCsv = async () => {
    if (!db) return;
    try {
      const file = await pickTextFile();
      if (!file) return;
      const summary = await importCsvWords(db, file.content, {
        track: settings.track,
        level: settings.level,
      });
      await notifyDataChanged();
      Alert.alert(
        'Nhập CSV xong',
        [
          `Đã thêm ${summary.added} từ.`,
          summary.skipped > 0 ? `Bỏ qua ${summary.skipped} từ trùng.` : '',
          summary.errors.length > 0
            ? `${summary.errors.length} dòng lỗi:\n${summary.errors.slice(0, 4).join('\n')}`
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
      );
    } catch (error) {
      Alert.alert('Không nhập được CSV', error instanceof Error ? error.message : 'Lỗi không rõ.');
    }
  };

  const confirmResetCoins = () => {
    Alert.alert(
      'Reset tiền xu?',
      `Số dư hiện tại (${(coins?.balance ?? 0).toLocaleString('vi-VN')} xu) sẽ về 0. Từ vựng, lịch sử học và chuỗi ngày vẫn được giữ nguyên. Hành động này không thể hoàn tác.`,
      [
        { text: 'Huỷ', style: 'cancel' },
        {
          text: 'Xác nhận reset',
          style: 'destructive',
          onPress: async () => {
            if (!db) return;
            await resetCoins(db);
            await notifyDataChanged();
            await loadCoins();
          },
        },
      ],
    );
  };

  const confirmResetProgress = () => {
    Alert.alert(
      'Reset tiến độ học?',
      'Mọi từ sẽ trở về trạng thái chưa học: xoá lịch ôn, số lần đúng/sai, mức ghi nhớ và tự đánh giá. Từ vựng, nghĩa, chủ đề, Album, tiền xu và chuỗi ngày được giữ nguyên. Không thể hoàn tác.',
      [
        { text: 'Huỷ', style: 'cancel' },
        {
          text: 'Reset tiến độ',
          style: 'destructive',
          onPress: async () => {
            if (!db) return;
            const result = await resetStudyProgress(db);
            // A new cycle lets the first correct re-learning earn once more,
            // while the old ledger stays visible for audit.
            await updateSettings({ studyCycleId: newId() });
            await notifyDataChanged();
            Alert.alert(
              'Đã reset tiến độ',
              `${result.wordsReset} từ về trạng thái chưa học · ${result.reviewsDeleted} lượt ôn cũ đã xoá. Album và tiền xu không đổi.`,
            );
          },
        },
      ],
    );
  };

  const confirmReset = () => {
    Alert.alert(
      'Xoá toàn bộ dữ liệu học?',
      'Tất cả từ, lịch sử ôn, chuỗi ngày và cài đặt sẽ bị xoá và bộ từ mẫu được khôi phục. Hãy xuất sao lưu trước.',
      [
        { text: 'Huỷ', style: 'cancel' },
        {
          text: 'Tiếp tục',
          style: 'destructive',
          onPress: () => {
            Alert.alert('Xác nhận lần cuối', 'Không thể hoàn tác thao tác này.', [
              { text: 'Không xoá', style: 'cancel' },
              {
                text: 'Xoá tất cả',
                style: 'destructive',
                onPress: async () => {
                  if (!db) return;
                  await resetDatabase(db);
                  await updateSettings({ onboardingDone: false });
                  await notifyDataChanged();
                  Alert.alert('Đã xoá', 'Ứng dụng đã trở về trạng thái ban đầu.');
                },
              },
            ]);
          },
        },
      ],
    );
  };

  return (
    <Screen>
      <ScreenHeader title="Cài đặt" subtitle="Dữ liệu, AI, nhắc nhở và widget" onBack={pop} />

      <SectionHeader title="AI" />
      <Card>
        <AppText variant="bodyStrong">Nhà cung cấp</AppText>
        <View style={styles.providerRow}>
          {AI_PROVIDERS.map((key) => {
            const active = key === provider;
            return (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => void switchProvider(key)}
                style={[
                  styles.providerButton,
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
                  {providerLabel(key)}
                </AppText>
              </Pressable>
            );
          })}
        </View>
        <AppText variant="micro" color={colors.textFaint} style={{ marginBottom: spacing.md }}>
          {providerInfo.keyHint} Key nằm trong Keychain của máy và không đi qua máy chủ nào khác.
        </AppText>

        <View style={styles.rowBetween}>
          <AppText variant="bodyStrong">API key</AppText>
          <AppText variant="caption" color={keyStatus === 'saved' ? colors.success : colors.warning}>
            {keyStatus === 'saved' ? 'Đã lưu trong Keychain' : keyStatus === 'loading' ? '…' : 'Chưa có'}
          </AppText>
        </View>
        <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.xs }}>
          Key chỉ dùng để gọi {providerInfo.label} từ iPhone. Ứng dụng không ghi key vào log, không
          gửi key tới máy chủ nào khác. Học và ôn tập luôn hoạt động khi không có key.
        </AppText>
        <Input
          value={keyInput}
          onChangeText={setKeyInput}
          placeholder={providerInfo.placeholder}
          secureTextEntry
          autoCapitalize="none"
          style={{ marginTop: spacing.md }}
        />
        {keyError ? (
          <AppText variant="caption" color={colors.danger} style={{ marginTop: spacing.xs }}>
            {keyError}
          </AppText>
        ) : null}
        <View style={styles.buttonRow}>
          <PrimaryButton
            label="Lưu key"
            style={{ flex: 1 }}
            onPress={() => void storeKey()}
            disabled={!keyInput.trim()}
          />
          <PrimaryButton
            label="Xoá key"
            variant="ghost"
            style={{ flex: 1 }}
            onPress={removeKey}
            disabled={keyStatus !== 'saved'}
          />
        </View>

        <PrimaryButton
          label={`Lấy key ${providerInfo.label}`}
          variant="ghost"
          style={{ marginTop: spacing.sm }}
          onPress={() => {
            Linking.openURL(providerInfo.keysUrl).catch(() => {
              Alert.alert(
                'Không mở được trình duyệt',
                `Tự mở ${providerInfo.keysUrl} để lấy key.`,
              );
            });
          }}
        />

        <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.md }}>
          Model
        </AppText>
        <Input
          value={modelValue}
          onChangeText={(value) =>
            void updateSettings(provider === 'groq' ? { groqModel: value } : { aiModel: value })
          }
          placeholder={defaultModel}
          autoCapitalize="none"
          style={{ marginTop: spacing.xs }}
        />
        <AppText variant="caption" color={colors.textFaint} style={{ marginTop: spacing.xs }}>
          {provider === 'groq'
            ? 'Groq có thể ngừng một model; khi đó app tự chuyển sang model còn hoạt động. Hạn mức miễn phí tính theo phút và theo ngày, nên nếu bị lỗi 429 hãy chờ hoặc tạo ít từ hơn mỗi lần.'
            : 'Google định kỳ ngừng các model cũ. Nếu model ở trên bị ngừng, app tự chuyển sang model khả dụng; bấm "Kiểm tra key + model" để xem và lưu lại tên model mới. Hạn mức miễn phí thay đổi theo thời gian và theo model.'}
        </AppText>

        <PrimaryButton
          label={checking ? 'Đang kiểm tra…' : 'Kiểm tra key + model'}
          variant="ghost"
          style={{ marginTop: spacing.md }}
          disabled={checking || keyStatus !== 'saved'}
          onPress={() => void verifyKey()}
        />
        {checkResult ? (
          <AppText
            variant="caption"
            color={checkResult.ok ? colors.success : colors.danger}
            style={{ marginTop: spacing.xs }}
          >
            {checkResult.ok ? '✓ ' : '✗ '}
            {checkResult.detail}
          </AppText>
        ) : null}
        {suggestedModel ? (
          <PrimaryButton
            label={`Dùng ${suggestedModel}`}
            style={{ marginTop: spacing.sm }}
            onPress={() => void useSuggestedModel(suggestedModel)}
          />
        ) : null}
      </Card>

      <Card style={{ marginTop: spacing.md }}>
        <View style={styles.rowBetween}>
          <AppText variant="bodyStrong">Lần gọi AI gần đây</AppText>
          <AppText variant="caption" color={colors.textMuted}>
            {diagnostics.length}/40
          </AppText>
        </View>
        <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.xs }}>
          Dùng khi AI báo lỗi: mỗi dòng cho biết nhà cung cấp (gemini/groq), giai đoạn (request →
          response → parse → validate), HTTP status, mã lỗi nội bộ, model và thời gian. Log chỉ nằm
          trong bộ nhớ của phiên này, không chứa API key hay nội dung bạn học.
        </AppText>
        {diagnostics.length === 0 ? (
          <AppText variant="caption" color={colors.textFaint} style={{ marginTop: spacing.sm }}>
            Chưa có lần gọi nào trong phiên này. Tạo một bộ từ rồi quay lại đây nếu cần xem lỗi.
          </AppText>
        ) : (
          diagnostics.slice(0, 10).map((entry) => (
            <AppText
              key={entry.id}
              variant="micro"
              color={
                entry.outcome === 'error'
                  ? colors.danger
                  : entry.outcome === 'retry'
                    ? colors.warning
                    : colors.textMuted
              }
              style={{ marginTop: spacing.xs }}
            >
              {formatDiagnostic(entry)}
              {entry.detail ? ` — ${entry.detail}` : ''}
            </AppText>
          ))
        )}
        <PrimaryButton
          label="Xoá log"
          variant="ghost"
          style={{ marginTop: spacing.md }}
          disabled={diagnostics.length === 0}
          onPress={() => {
            clearDiagnostics();
            setDiagnostics(getDiagnostics());
          }}
        />
      </Card>

      <SectionHeader title="Học tập" />
      <Card>
        <Stepper
          label="Mục tiêu mỗi ngày"
          value={settings.dailyGoal}
          min={1}
          max={100}
          step={5}
          suffix="lượt"
          onChange={(dailyGoal) => void updateSettings({ dailyGoal })}
        />
        <AppText variant="caption" color={colors.textMuted}>
          Một lượt = một từ mới hoặc một lần ôn. Đạt mục tiêu sẽ giữ chuỗi ngày học.
        </AppText>
        <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.md }}>
          Mức ghi nhớ mong muốn (cao hơn = ôn dày hơn)
        </AppText>
        <View style={{ marginTop: spacing.xs }}>
          <ChipRow>
            {[0.85, 0.9, 0.95].map((value) => (
              <Pressable
                key={value}
                onPress={() => void updateSettings({ targetRetention: value })}
                style={[
                  styles.choice,
                  {
                    borderColor:
                      settings.targetRetention === value ? colors.primary : colors.border,
                    backgroundColor:
                      settings.targetRetention === value ? colors.primarySoft : 'transparent',
                  },
                ]}
              >
                <AppText
                  variant="caption"
                  color={settings.targetRetention === value ? colors.primary : colors.textMuted}
                >
                  {Math.round(value * 100)}%
                </AppText>
              </Pressable>
            ))}
          </ChipRow>
        </View>
      </Card>

      <SectionHeader title="Lịch ôn tập" />
      <Card>
        <AppText variant="caption" color={colors.textMuted}>
          Khi bạn tự đánh giá một từ, lần kiểm tra tiếp theo được hẹn đúng khoảng thời gian dưới
          đây. FSRS vẫn cập nhật độ bền trí nhớ, nhưng ngày ôn do bạn quyết định.
        </AppText>
        <View style={{ marginTop: spacing.md }}>
          {(
            [
              ['again', 'Chưa nhớ'],
              ['hard', 'Khó'],
              ['good', 'Dễ'],
              ['easy', 'Rất dễ'],
            ] as [keyof ReviewIntervals, string][]
          ).map(([key, label]) => (
            <IntervalEditor
              key={key}
              label={label}
              minutes={settings.reviewIntervals[key]}
              onCommit={(minutes) =>
                void updateSettings({
                  reviewIntervals: { ...settings.reviewIntervals, [key]: minutes },
                })
              }
            />
          ))}
        </View>
        <PrimaryButton
          label="Khôi phục mặc định (5 phút · 30 phút · 12 giờ · 24 giờ)"
          variant="ghost"
          onPress={() => void updateSettings({ reviewIntervals: DEFAULT_REVIEW_INTERVALS })}
          style={{ marginTop: spacing.sm }}
        />
        <AppText variant="caption" color={colors.textFaint} style={{ marginTop: spacing.sm }}>
          Đơn vị là phút, từ {MIN_REVIEW_INTERVAL} đến {MAX_REVIEW_INTERVAL.toLocaleString('vi-VN')}{' '}
          (7 ngày). Thay đổi chỉ áp dụng cho lượt đánh giá tiếp theo; lịch đã hẹn trước đó không bị
          viết lại.
        </AppText>
      </Card>

      <SectionHeader title="Kinh tế · Xu ảo" />
      <Card>
        <View style={styles.rowBetween}>
          <View>
            <AppText variant="micro" color={colors.textFaint}>
              SỐ DƯ XU
            </AppText>
            <AppText variant="display">
              {(coins?.balance ?? 0).toLocaleString('vi-VN')}
            </AppText>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <AppText variant="headline" color={colors.warning}>
              x{(coins?.multiplier ?? 1).toFixed(1)}
            </AppText>
            <AppText variant="caption" color={colors.textMuted}>
              {coins?.validStreakDays ?? 0} ngày hợp lệ
            </AppText>
          </View>
        </View>
        <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.sm }}>
          Mỗi từ mới trả xu theo cấp độ. Còn{' '}
          {coins?.nextMilestone.remaining ?? 10} ngày liên tục để lên hệ số x
          {(coins?.nextMilestone.multiplier ?? 1.1).toFixed(1)}. Trả lời sai khi ôn sẽ bị trừ xu
          theo giá trị gốc, không bao giờ âm.
        </AppText>
        {restoreTarget ? (
          <AppText variant="caption" color={colors.primary} style={{ marginTop: spacing.xs }}>
            Chuỗi đang chờ khôi phục: {restoreTarget}
          </AppText>
        ) : null}

        <AppText variant="micro" color={colors.textFaint} style={{ marginTop: spacing.lg }}>
          LỊCH SỬ GẦN ĐÂY
        </AppText>
        {coinHistory.length > 0 ? (
          coinHistory.map((event) => (
            <View key={event.id} style={styles.coinRow}>
              <View style={{ flex: 1 }}>
                <AppText variant="caption">
                  {event.kind === 'reset'
                    ? 'Reset số dư'
                    : event.kind === 'penalty'
                      ? 'Ôn sai'
                      : 'Học từ mới'}
                </AppText>
                <AppText variant="micro" color={colors.textFaint}>
                  {new Date(event.createdAt).toLocaleString('vi-VN')}
                </AppText>
              </View>
              <AppText
                variant="bodyStrong"
                color={event.amount >= 0 ? colors.success : colors.danger}
              >
                {event.amount >= 0 ? '+' : ''}
                {event.amount.toLocaleString('vi-VN')}
              </AppText>
            </View>
          ))
        ) : (
          <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.xs }}>
            Chưa có giao dịch. Hãy học một từ mới và trả lời đúng để nhận xu đầu tiên.
          </AppText>
        )}

        <PrimaryButton
          label="Reset tiền xu"
          variant="danger"
          onPress={confirmResetCoins}
          style={{ marginTop: spacing.md }}
        />
        <AppText variant="caption" color={colors.textFaint} style={{ marginTop: spacing.xs }}>
          Reset chỉ đưa số dư về 0 và ghi lại một sự kiện trong lịch sử. Từ vựng, lịch sử học,
          chuỗi ngày và cài đặt khác không bị xoá. Không thể hoàn tác.
        </AppText>
      </Card>

      <SectionHeader title="Giao diện" />
      <Card>
        <ChipRow>
          {(['system', 'light', 'dark'] as ThemeMode[]).map((mode) => (
            <Pressable
              key={mode}
              onPress={() => void updateSettings({ themeMode: mode })}
              style={[
                styles.choice,
                {
                  borderColor: settings.themeMode === mode ? colors.primary : colors.border,
                  backgroundColor:
                    settings.themeMode === mode ? colors.primarySoft : 'transparent',
                },
              ]}
            >
              <AppText
                variant="caption"
                color={settings.themeMode === mode ? colors.primary : colors.textMuted}
              >
                {mode === 'system' ? 'Theo máy' : mode === 'light' ? 'Sáng' : 'Tối'}
              </AppText>
            </Pressable>
          ))}
        </ChipRow>
      </Card>

      <SectionHeader title="Nhạc nền" />
      <Card>
        <View style={styles.rowBetween}>
          <AppText variant="bodyStrong">Phát nhạc khi học</AppText>
          <Switch
            value={settings.musicEnabled}
            onValueChange={(value) => void updateSettings({ musicEnabled: value })}
            trackColor={{ true: colors.primary, false: colors.border }}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Mở thư viện nhạc nền"
          onPress={() => push({ name: 'music' })}
          style={[
            styles.musicRow,
            { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
          ]}
        >
          <View style={{ flex: 1 }}>
            <AppText variant="bodyStrong">{music.track.name}</AppText>
            <AppText variant="caption" color={colors.textMuted}>
              {music.track.mood} · {music.track.bpm} BPM · {Math.round(settings.musicVolume * 100)}%
            </AppText>
          </View>
          <AppText variant="caption" color={colors.primary}>
            Chọn nhạc ›
          </AppText>
        </Pressable>
        <Stepper
          label="Âm lượng nhạc"
          value={Math.round(settings.musicVolume * 100)}
          min={0}
          max={100}
          step={10}
          suffix="%"
          onChange={(value) =>
            void updateSettings({ musicVolume: value / 100, musicMuted: false })
          }
        />
        <View style={styles.rowBetween}>
          <AppText variant="bodyStrong">Tắt tiếng tạm thời</AppText>
          <Switch
            value={settings.musicMuted}
            onValueChange={(value) => void updateSettings({ musicMuted: value })}
            trackColor={{ true: colors.primary, false: colors.border }}
          />
        </View>
        <AppText variant="caption" color={colors.textFaint} style={{ marginTop: spacing.xs }}>
          Nhạc lưu sẵn trong app, tự dừng khi bạn rời ứng dụng và không cần mạng. Mở thư viện để
          tìm theo tên hoặc tâm trạng.
        </AppText>
      </Card>

      <SectionHeader title="Phát âm" />
      <Card>
        <AppText variant="caption" color={colors.textMuted}>
          Giọng đọc (dùng voice có sẵn trên iPhone, miễn phí)
        </AppText>
        <View style={{ marginTop: spacing.sm }}>
          <ChipRow>
            {(['en-US', 'en-GB'] as const).map((accent) => (
              <Pressable
                key={accent}
                onPress={() => void updateSettings({ ttsAccent: accent })}
                style={[
                  styles.choice,
                  {
                    borderColor: settings.ttsAccent === accent ? colors.primary : colors.border,
                    backgroundColor:
                      settings.ttsAccent === accent ? colors.primarySoft : 'transparent',
                  },
                ]}
              >
                <AppText
                  variant="caption"
                  color={settings.ttsAccent === accent ? colors.primary : colors.textMuted}
                >
                  {accent === 'en-US' ? 'Anh–Mỹ' : 'Anh–Anh'}
                </AppText>
              </Pressable>
            ))}
          </ChipRow>
        </View>
        <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.md }}>
          Giọng đọc ưu tiên
        </AppText>
        <View style={{ marginTop: spacing.sm }}>
          <ChipRow>
            {(['auto', 'female', 'male'] as TtsVoice[]).map((voice) => (
              <Pressable
                key={voice}
                onPress={() => void updateSettings({ ttsVoice: voice })}
                style={[
                  styles.choice,
                  {
                    borderColor: settings.ttsVoice === voice ? colors.primary : colors.border,
                    backgroundColor:
                      settings.ttsVoice === voice ? colors.primarySoft : 'transparent',
                  },
                ]}
              >
                <AppText
                  variant="caption"
                  color={settings.ttsVoice === voice ? colors.primary : colors.textMuted}
                >
                  {voice === 'auto' ? 'Tự động' : voice === 'female' ? 'Giọng nữ' : 'Giọng nam'}
                </AppText>
              </Pressable>
            ))}
          </ChipRow>
        </View>
        {settings.ttsVoice !== 'auto' &&
        voiceAvailability(voices, settings.ttsAccent, settings.ttsVoice) === 'accent-only' ? (
          <AppText variant="caption" color={colors.warning} style={{ marginTop: spacing.sm }}>
            iPhone này chưa cài giọng {settings.ttsVoice === 'male' ? 'nam' : 'nữ'}{' '}
            {settings.ttsAccent === 'en-GB' ? 'Anh–Anh' : 'Anh–Mỹ'}. Đang dùng giọng phù hợp nhất
            hiện có; thêm giọng trong Cài đặt iOS → Trợ năng → Nội dung đọc → Giọng.
          </AppText>
        ) : null}
        {voiceAvailability(voices, settings.ttsAccent, settings.ttsVoice) === 'none' ? (
          <AppText variant="caption" color={colors.warning} style={{ marginTop: spacing.sm }}>
            Chưa tìm thấy giọng tiếng Anh nào trên máy. Hãy tải giọng trong Cài đặt iOS → Trợ năng
            → Nội dung đọc → Giọng → Tiếng Anh.
          </AppText>
        ) : null}
        <PrimaryButton
          label="Nghe thử"
          variant="ghost"
          onPress={() =>
            speak('Practice a little every day, and the words will stay.', {
              accent: settings.ttsAccent,
              voice: settings.ttsVoice,
            })
          }
          style={{ marginTop: spacing.sm }}
        />
      </Card>

      <SectionHeader title="Hiệu ứng âm thanh" />
      <Card>
        <View style={styles.rowBetween}>
          <View style={{ flex: 1 }}>
            <AppText variant="bodyStrong">Bật hiệu ứng</AppText>
            <AppText variant="caption" color={colors.textMuted}>
              Tiếng ngắn khi đúng, sai, nhận xu, xong lượt học và bắn trúng thiên thạch.
            </AppText>
          </View>
          <Switch
            value={settings.sfxEnabled}
            onValueChange={(value) => void updateSettings({ sfxEnabled: value })}
            trackColor={{ true: colors.primary, false: colors.border }}
          />
        </View>
        <Stepper
          label="Âm lượng hiệu ứng"
          value={Math.round(settings.sfxVolume * 100)}
          min={0}
          max={100}
          step={5}
          suffix="%"
          onChange={(value) => void updateSettings({ sfxVolume: value / 100 })}
        />
        <PrimaryButton
          label="Nghe thử"
          variant="ghost"
          disabled={!settings.sfxEnabled}
          onPress={() => playSfx('correct')}
        />
        <AppText variant="caption" color={colors.textFaint} style={{ marginTop: spacing.xs }}>
          Tắt hiệu ứng không tắt giọng đọc từ vựng. Hiệu ứng được giới hạn tần suất để không chồng
          lên nhau hay chen vào lúc đang đọc từ.
        </AppText>
      </Card>

      <SectionHeader title="Nhắc nhở học" />
      <Card>
        <View style={styles.rowBetween}>
          <AppText variant="bodyStrong">Bật nhắc nhở</AppText>
          <Switch
            value={settings.remindersEnabled}
            onValueChange={async (value) => {
              const next = await updateSettings({ remindersEnabled: value });
              await applyReminders(next);
            }}
            trackColor={{ true: colors.primary, false: colors.border }}
          />
        </View>
        <AppText variant="caption" color={colors.textFaint} style={{ marginTop: spacing.xs }}>
          Quyền thông báo: {notificationStatus}
        </AppText>
        <View style={{ marginTop: spacing.sm }}>
          <Stepper
            label="Giờ nhắc"
            value={settings.reminderHour}
            min={0}
            max={23}
            step={1}
            suffix="giờ"
            onChange={(hour) => {
              void updateSettings({ reminderHour: hour }).then((next) => {
                if (next.remindersEnabled) void applyReminders(next);
              });
            }}
          />
          <Stepper
            label="Phút"
            value={settings.reminderMinute}
            min={0}
            max={45}
            step={15}
            suffix="phút"
            onChange={(minute) => {
              void updateSettings({ reminderMinute: minute }).then((next) => {
                if (next.remindersEnabled) void applyReminders(next);
              });
            }}
          />
        </View>
        <AppText variant="caption" color={colors.textMuted}>
          Các ngày trong tuần
        </AppText>
        <View style={{ marginTop: spacing.xs }}>
          <ChipRow>
            {WEEKDAYS.map((day) => {
              const active = settings.reminderWeekdays.includes(day.value);
              return (
                <Pressable
                  key={day.value}
                  onPress={() => void toggleWeekday(day.value)}
                  style={[
                    styles.choice,
                    {
                      borderColor: active ? colors.primary : colors.border,
                      backgroundColor: active ? colors.primarySoft : 'transparent',
                    },
                  ]}
                >
                  <AppText variant="caption" color={active ? colors.primary : colors.textMuted}>
                    {day.label}
                  </AppText>
                </Pressable>
              );
            })}
          </ChipRow>
        </View>
        <PrimaryButton
          label="Lên lịch lại ngay"
          variant="ghost"
          onPress={() => void applyReminders()}
          style={{ marginTop: spacing.sm }}
        />
      </Card>

      <SectionHeader title="Widget" />
      <Card>
        <AppText variant="caption" color={colors.textMuted} style={{ marginBottom: spacing.sm }}>
          Track hiển thị trên widget
        </AppText>
        <TrackSwitcher
          value={settings.widgetTrack}
          onChange={(track) => void updateSettings({ widgetTrack: track })}
        />
        <View style={styles.rowBetween}>
          <AppText variant="caption" color={colors.textMuted}>
            Từ cần ôn hiện tại
          </AppText>
          <AppText variant="bodyStrong">{stats?.dueCount ?? 0}</AppText>
        </View>
        <PrimaryButton
          label="Cập nhật widget ngay"
          variant="secondary"
          onPress={async () => {
            await notifyDataChanged();
            Alert.alert(
              'Đã yêu cầu cập nhật widget',
              widgetStatus
                ? `Ghi nhận: ${widgetStatus}`
                : 'iOS có thể trì hoãn việc vẽ lại widget vài phút. Mở app lại để chắc chắn dữ liệu mới.',
            );
          }}
          style={{ marginTop: spacing.md }}
        />
        <AppText variant="caption" color={colors.textFaint} style={{ marginTop: spacing.sm }}>
          iOS quyết định thời điểm làm mới widget, nên không thể cập nhật tức thì mọi lúc. Dữ liệu
          được đẩy khi bạn học, sửa từ hoặc mở lại ứng dụng.
        </AppText>
      </Card>

      <SectionHeader title="Dữ liệu" />
      <Card>
        <View style={styles.buttonRow}>
          <PrimaryButton
            label="Xuất JSON"
            variant="secondary"
            style={{ flex: 1 }}
            loading={busy === 'json'}
            onPress={() => void doExportJson()}
          />
          <PrimaryButton
            label="Xuất CSV"
            variant="secondary"
            style={{ flex: 1 }}
            loading={busy === 'csv'}
            onPress={() => void doExportCsv()}
          />
        </View>
        <View style={[styles.buttonRow, { marginTop: spacing.sm }]}>
          <PrimaryButton
            label="Khôi phục JSON"
            variant="ghost"
            style={{ flex: 1 }}
            onPress={() => void doImportJson()}
          />
          <PrimaryButton
            label="Nhập CSV"
            variant="ghost"
            style={{ flex: 1 }}
            onPress={() => void doImportCsv()}
          />
        </View>
        <AppText variant="caption" color={colors.textFaint} style={{ marginTop: spacing.sm }}>
          Bản sao lưu JSON chứa từ vựng, lịch sử ôn và cài đặt. CSV phù hợp để mở bằng Excel hoặc
          chia sẻ danh sách từ.
        </AppText>
      </Card>

      <SectionHeader title="Nguy hiểm" />
      <Card>
        <PrimaryButton
          label="Reset dữ liệu học tập"
          variant="danger"
          onPress={confirmResetProgress}
        />
        <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.sm }}>
          Đưa mọi từ về chưa học để học lại từ đầu. Giữ từ vựng, nghĩa, chủ đề, level, Album,
          tiền xu và chuỗi ngày. Sau khi reset, lần học lại đầu tiên của mỗi từ có thể nhận xu
          theo quy tắc hiện hành; lịch sử giao dịch cũ vẫn còn trong sổ xu.
        </AppText>
        <PrimaryButton
          label="Xoá toàn bộ dữ liệu học"
          variant="danger"
          onPress={confirmReset}
          style={{ marginTop: spacing.md }}
        />
        <AppText variant="caption" color={colors.textFaint} style={{ marginTop: spacing.xs }}>
          Khác với reset tiến độ: thao tác này xoá cả từ, Album, xu, chuỗi ngày và cài đặt, rồi
          khôi phục bộ từ mẫu.
        </AppText>
      </Card>

      <SectionHeader title="Thông tin" />
      <Card>
        <AppText variant="micro" color={colors.textFaint}>
          NHÀ PHÁT TRIỂN
        </AppText>
        <AppText variant="headline" style={{ marginTop: 2 }}>
          Dev: Phạm Bảo Lâm
        </AppText>
        <Divider />
        <AppText variant="caption" color={colors.textMuted}>
          VocabMaster 0.1.0 · Expo SDK 58 · dữ liệu lưu cục bộ bằng SQLite.
        </AppText>
        <AppText variant="caption" color={colors.textFaint} style={{ marginTop: spacing.sm }}>
          Widget và nhận diện giọng nói cần bản build native, không chạy trong Expo Go. Xem
          CHECKPOINT.md và README.md trong thư mục dự án để biết cách build và cài lên iPhone.
        </AppText>
      </Card>
    </Screen>
  );
}

function describeMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} phút`;
  if (minutes % 1_440 === 0) return `${minutes / 1_440} ngày`;
  if (minutes % 60 === 0) return `${minutes / 60} giờ`;
  return `${Math.floor(minutes / 60)} giờ ${minutes % 60} phút`;
}

/**
 * Numeric interval editor. The value is committed on blur or submit instead of
 * on every keystroke, so typing "30" does not briefly save "3" and reschedule
 * two words on the way.
 */
function IntervalEditor({
  label,
  minutes,
  onCommit,
}: {
  label: string;
  minutes: number;
  onCommit: (minutes: number) => void;
}) {
  const { colors } = useTheme();
  const [text, setText] = useState(String(minutes));

  useEffect(() => {
    setText(String(minutes));
  }, [minutes]);

  const commit = () => {
    const parsed = Number.parseInt(text, 10);
    if (!Number.isFinite(parsed)) {
      setText(String(minutes));
      return;
    }
    const next = Math.min(MAX_REVIEW_INTERVAL, Math.max(MIN_REVIEW_INTERVAL, parsed));
    setText(String(next));
    if (next !== minutes) onCommit(next);
  };

  return (
    <View style={styles.intervalRow}>
      <View style={{ flex: 1 }}>
        <AppText variant="bodyStrong">{label}</AppText>
        <AppText variant="caption" color={colors.textMuted}>
          Hiện tại: {describeMinutes(minutes)}
        </AppText>
      </View>
      <View style={styles.intervalInput}>
        <Input
          value={text}
          onChangeText={setText}
          keyboardType="number-pad"
          maxLength={5}
          onSubmitEditing={commit}
          onBlur={commit}
          style={{ width: 86 }}
        />
        <AppText variant="caption" color={colors.textFaint} style={{ marginLeft: spacing.xs }}>
          phút
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  buttonRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  providerRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  providerButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  choice: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  coinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(140,148,173,0.18)',
  },
  musicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  intervalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  intervalInput: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 130,
  },
});

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, View } from 'react-native';

import { AppText, Banner, Card, PrimaryButton, Screen, SectionHeader } from '../components/ui';
import { ChipRow, Input, ScreenHeader, Stepper, TrackSwitcher } from '../components/patterns';
import { checkApiKey, clearApiKey, hasApiKey, saveApiKey, type KeyCheck } from '../ai/gemini';
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
import {
  cancelReminders,
  getNotificationPermission,
  requestNotificationPermission,
  scheduleReminders,
} from '../notifications/reminders';
import { speak } from '../speech/tts';
import { useApp } from '../state/AppProvider';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/tokens';
import { DEFAULT_AI_MODEL, type ThemeMode } from '../types';
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
  const { db, settings, updateSettings, notifyDataChanged, widgetStatus, stats } = useApp();
  const { pop } = useNavigation();
  const { colors } = useTheme();

  const [keyStatus, setKeyStatus] = useState<'loading' | 'missing' | 'saved'>('loading');
  const [keyInput, setKeyInput] = useState('');
  const [keyError, setKeyError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<KeyCheck | null>(null);
  const [notificationStatus, setNotificationStatus] = useState<string>('…');
  const [busy, setBusy] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<AiDiagnostic[]>(() => getDiagnostics());

  // In-memory only: it survives navigation, not an app restart, and never holds
  // the API key or the learner's content.
  useEffect(() => subscribeDiagnostics(() => setDiagnostics(getDiagnostics())), []);

  // Model Google đề xuất khi model đang cấu hình đã bị ngừng.
  const suggestedModel = checkResult && !checkResult.ok ? checkResult.suggestedModel ?? null : null;

  const refreshKeyStatus = useCallback(async () => {
    const exists = await hasApiKey();
    setKeyStatus(exists ? 'saved' : 'missing');
  }, []);

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

  const storeKey = async () => {
    setKeyError(null);
    try {
      await saveApiKey(keyInput);
      setKeyInput('');
      await refreshKeyStatus();
      Alert.alert(
        'Đã lưu API key',
        'Key được lưu trong Keychain của iPhone và không nằm trong mã nguồn hay file sao lưu.',
      );
    } catch (error) {
      setKeyError(error instanceof Error ? error.message : 'Không lưu được key.');
    }
  };

  const verifyKey = async (model = settings.aiModel) => {
    setChecking(true);
    setCheckResult(null);
    try {
      setCheckResult(await checkApiKey(model));
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
    await updateSettings({ aiModel: model });
    await verifyKey(model);
  };

  const removeKey = () => {
    Alert.alert('Xoá Gemini API key?', 'Bạn vẫn có thể học và ôn tập bình thường.', [
      { text: 'Huỷ', style: 'cancel' },
      {
        text: 'Xoá',
        style: 'destructive',
        onPress: async () => {
          await clearApiKey();
          await refreshKeyStatus();
        },
      },
    ]);
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

      <SectionHeader title="Gemini AI" />
      <Card>
        <View style={styles.rowBetween}>
          <AppText variant="bodyStrong">API key</AppText>
          <AppText variant="caption" color={keyStatus === 'saved' ? colors.success : colors.warning}>
            {keyStatus === 'saved' ? 'Đã lưu trong Keychain' : keyStatus === 'loading' ? '…' : 'Chưa có'}
          </AppText>
        </View>
        <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.xs }}>
          Key chỉ dùng để gọi Gemini từ iPhone. Ứng dụng không ghi key vào log, không gửi key tới
          máy chủ nào khác. Học và ôn tập luôn hoạt động khi không có key.
        </AppText>
        <Input
          value={keyInput}
          onChangeText={setKeyInput}
          placeholder="Dán Gemini API key (AIza…)"
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

        <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.md }}>
          Model
        </AppText>
        <Input
          value={settings.aiModel}
          onChangeText={(value) => void updateSettings({ aiModel: value })}
          placeholder={DEFAULT_AI_MODEL}
          style={{ marginTop: spacing.xs }}
        />
        <AppText variant="caption" color={colors.textFaint} style={{ marginTop: spacing.xs }}>
          Google định kỳ ngừng các model cũ. Nếu model ở trên bị ngừng, app tự chuyển sang model
          khả dụng; bấm "Kiểm tra key + model" để xem và lưu lại tên model mới. Hạn mức miễn phí
          thay đổi theo thời gian và theo model.
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
          <AppText variant="bodyStrong">Lần gọi Gemini gần đây</AppText>
          <AppText variant="caption" color={colors.textMuted}>
            {diagnostics.length}/40
          </AppText>
        </View>
        <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.xs }}>
          Dùng khi Gemini báo lỗi: mỗi dòng cho biết giai đoạn (request → response → parse →
          validate), HTTP status, mã lỗi nội bộ, model và thời gian. Log chỉ nằm trong bộ nhớ của
          phiên này, không chứa API key hay nội dung bạn học.
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
        <PrimaryButton
          label="Nghe thử"
          variant="ghost"
          onPress={() =>
            speak('Practice a little every day, and the words will stay.', {
              accent: settings.ttsAccent,
            })
          }
          style={{ marginTop: spacing.sm }}
        />
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
        <PrimaryButton label="Xoá toàn bộ dữ liệu học" variant="danger" onPress={confirmReset} />
      </Card>

      <SectionHeader title="Thông tin" />
      <Card>
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

const styles = StyleSheet.create({
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  buttonRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  choice: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
});

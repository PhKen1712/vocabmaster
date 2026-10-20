import * as Notifications from 'expo-notifications';

import type { Settings } from '../types';

/**
 * Local notifications only: no push server, no cost. iOS decides the exact
 * delivery time and may delay notifications in Low Power Mode or Focus.
 */

export function configureNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

export async function getNotificationPermission(): Promise<'granted' | 'denied' | 'undetermined'> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return 'granted';
  if (current.canAskAgain) return 'undetermined';
  return 'denied';
}

export async function requestNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const next = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: false, allowSound: true },
  });
  return next.granted;
}

export async function cancelReminders(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

/**
 * Re-create the weekly reminder schedule. Called on every settings change so the
 * phone always has exactly one notification per selected weekday.
 */
export async function scheduleReminders(
  settings: Settings,
  dueCount: number,
): Promise<number> {
  await cancelReminders();
  if (!settings.remindersEnabled) return 0;

  const granted = await requestNotificationPermission();
  if (!granted) return 0;

  const body =
    dueCount > 0
      ? `${dueCount} từ đang chờ bạn ôn tập. Vài phút hôm nay giữ được chuỗi ngày học.`
      : 'Học vài từ mới để giữ chuỗi ngày học và mở khóa bài tiếp theo.';

  let scheduled = 0;
  for (const weekday of settings.reminderWeekdays) {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Đến giờ học từ vựng',
          body,
          data: { screen: 'today' },
          sound: false,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          weekday,
          hour: settings.reminderHour,
          minute: settings.reminderMinute,
        },
      });
      scheduled += 1;
    } catch {
      // A single bad weekday must not cancel the others.
    }
  }
  return scheduled;
}

export async function getScheduledReminderCount(): Promise<number> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  return scheduled.length;
}

import * as Notifications from 'expo-notifications';
import type { SQLiteDatabase } from 'expo-sqlite';

import {
  listAlbumNotificationCandidates,
  markAlbumNotified,
  type AlbumNotificationCandidate,
} from '../db/album';
import type { Settings } from '../types';
import {
  albumCoverageHours,
  MIN_ALBUM_INTERVAL_MINUTES,
} from './interval';
import { chooseAlbumWord } from './selection';
import { requestNotificationPermission } from './reminders';

/**
 * Album notifications.
 *
 * The learner adds words to the Album once; the app then picks a random word
 * for each notification by itself. There is no per-word toggle.
 *
 * iOS does not let an app run a timer in the background to deliver "every 10
 * minutes" forever, and it keeps at most 64 pending local notifications. So the
 * app pre-schedules a bounded queue (48 slots) of real DATE notifications and
 * tops it up whenever the app opens or the album changes. The UI states this
 * limit instead of promising a schedule iOS cannot keep.
 */

export const ALBUM_NOTIFICATION_LIMIT = 48;

export type AlbumScheduleReason = 'disabled' | 'permission' | 'no-words' | 'ok';

export interface AlbumScheduleResult {
  scheduled: number;
  reason: AlbumScheduleReason;
  /** True when the queue is shorter than the requested interval window. */
  truncated: boolean;
  /** Hours the queue covers at the learner's cycle, so the UI can be honest. */
  coverageHours: number;
}

function notificationKind(request: Notifications.NotificationRequest): string | null {
  const data = request.content.data as Record<string, unknown> | null;
  const kind = data?.kind;
  if (typeof kind === 'string') return kind;
  // Notifications scheduled by builds before `kind` existed were weekly study
  // reminders; keep being able to cancel them.
  if (data?.screen === 'today') return 'reminder';
  return null;
}

export async function cancelAlbumNotifications(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((request) => notificationKind(request) === 'album')
      .map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier)),
  );
}

function nextWindowSlot(after: Date, startHour: number, endHour: number): Date {
  const slot = new Date(after);
  const allDay = endHour <= startHour;
  if (allDay) return slot;

  if (slot.getHours() < startHour) {
    slot.setHours(startHour, 0, 0, 0);
    return slot;
  }
  if (slot.getHours() >= endHour) {
    slot.setDate(slot.getDate() + 1);
    slot.setHours(startHour, 0, 0, 0);
  }
  return slot;
}

function buildBody(candidate: AlbumNotificationCandidate): string {
  const lines = [candidate.meaningVi];
  if (candidate.exampleEn) lines.push(candidate.exampleEn);
  if (candidate.exampleVi) lines.push(candidate.exampleVi);
  return lines.join('\n');
}

/**
 * Replace the current album queue. Always cancels the old album notifications
 * first, so disabling the feature cannot leave a stray schedule behind.
 */
export async function scheduleAlbumNotifications(
  db: SQLiteDatabase,
  settings: Settings,
  now: Date = new Date(),
): Promise<AlbumScheduleResult> {
  await cancelAlbumNotifications();
  if (!settings.albumNotifyEnabled) {
    return { scheduled: 0, reason: 'disabled', truncated: false, coverageHours: 0 };
  }

  const candidates = await listAlbumNotificationCandidates(db);
  if (candidates.length === 0) {
    return { scheduled: 0, reason: 'no-words', truncated: false, coverageHours: 0 };
  }

  const granted = await requestNotificationPermission();
  if (!granted) {
    return { scheduled: 0, reason: 'permission', truncated: false, coverageHours: 0 };
  }

  // The learner's own cycle is honoured exactly. Any hidden floor here would
  // silently overrule a deliberate 7-minute or 90-minute choice.
  const intervalMinutes = Math.max(MIN_ALBUM_INTERVAL_MINUTES, settings.albumIntervalMinutes);
  const intervalMs = intervalMinutes * 60_000;
  const startHour = settings.albumStartHour;
  const endHour = settings.albumEndHour;
  const windowMinutes = endHour > startHour ? (endHour - startHour) * 60 : 24 * 60;
  const slotsInWindow = Math.floor(windowMinutes / intervalMinutes);
  const truncated = slotsInWindow > ALBUM_NOTIFICATION_LIMIT;

  // In-memory state keeps the first 48 picks balanced without 48 DB reads.
  const state = candidates.map((candidate) => ({ ...candidate }));
  const chosenIds: string[] = [];
  const chosenAt: string[] = [];
  let lastId: string | null = null;
  let cursor = new Date(now.getTime() + intervalMs);
  let scheduled = 0;

  for (let index = 0; index < ALBUM_NOTIFICATION_LIMIT; index += 1) {
    const slot = nextWindowSlot(cursor, startHour, endHour);
    // A malformed window could push the queue years away; stop honestly.
    if (slot.getTime() - now.getTime() > 60 * 86_400_000) break;

    const pickedId = chooseAlbumWord(state, lastId, slot.getTime());
    if (!pickedId) break;
    const picked = state.find((candidate) => candidate.id === pickedId);
    if (!picked) break;

    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: picked.term,
          body: buildBody(picked),
          data: { kind: 'album', screen: 'word', id: picked.id },
          sound: false,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: slot,
        },
      });
      scheduled += 1;
      chosenIds.push(picked.id);
      chosenAt.push(slot.toISOString());
      lastId = picked.id;
      picked.notifyCount += 1;
      picked.lastNotifiedAt = slot.toISOString();
    } catch {
      // One bad slot must not discard the ones already scheduled.
      break;
    }

    cursor = new Date(slot.getTime() + intervalMs);
  }

  // Update each word with its own scheduled time; this is what makes the next
  // queue favour words that have not been shown recently.
  for (let index = 0; index < chosenIds.length; index += 1) {
    const id = chosenIds[index];
    if (!id) continue;
    await markAlbumNotified(db, [id], chosenAt[index] ?? now.toISOString());
  }

  return {
    scheduled,
    reason: 'ok',
    truncated,
    coverageHours: albumCoverageHours(intervalMinutes, scheduled),
  };
}

export async function getScheduledAlbumCount(): Promise<number> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  return scheduled.filter((request) => notificationKind(request) === 'album').length;
}

/** Used by Settings to explain why a queue is empty. */
export function describeAlbumSchedule(result: AlbumScheduleResult): string | null {
  if (result.reason === 'permission') return 'Chưa có quyền thông báo trên thiết bị.';
  if (result.reason === 'no-words') return 'Album đang trống — thêm từ trước khi bật thông báo.';
  if (result.reason === 'disabled') return null;
  if (result.scheduled === 0) return 'Chưa lên được thông báo nào. Thử lại sau.';
  if (result.truncated) {
    return `Đã lên ${result.scheduled} thông báo (khoảng ${Math.round(result.coverageHours)} giờ theo chu kỳ của bạn). iOS giới hạn thông báo đang chờ, nên app giữ một hàng đợi ngắn và bổ sung khi bạn mở app.`;
  }
  return `Đã lên ${result.scheduled} thông báo tiếp theo.`;
}


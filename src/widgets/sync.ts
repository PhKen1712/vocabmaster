import { Platform } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';

// Metro provides `require` at runtime; declaring it keeps TypeScript happy
// without pulling Node types into a React Native project.
declare const require: (id: string) => { default: unknown };

import { getActivityForDate, getStreak } from '../db/activity';
import { getCounts, getWordOfTheDay } from '../db/words';
import { dateKey } from '../lib/date';
import { nowIso } from '../lib/ids';
import type { Settings } from '../types';
import { buildDailyWordProps, buildGlanceProps, type DailyWordProps, type GlanceProps } from './snapshot';

type WidgetHandle<T> = {
  updateSnapshot: (props: T) => void;
  updateTimeline: (entries: { date: Date; props: T }[]) => void;
};

/**
 * Push real study data into the iOS widget extension.
 *
 * iOS owns widget refresh scheduling. `updateSnapshot` asks the system to
 * refresh immediately, but the system may delay or coalesce it (Low Power Mode,
 * many widgets, etc.). The app also refreshes on every foreground transition
 * and after each answer, which is the reliable path; nothing here promises
 * instant updates.
 */

export interface WidgetSyncResult {
  ok: boolean;
  reason?: string;
}

export async function syncWidgets(
  db: SQLiteDatabase,
  settings: Settings,
): Promise<WidgetSyncResult> {
  if (Platform.OS !== 'ios') {
    return { ok: false, reason: 'Widgets chỉ có trên iOS.' };
  }

  try {
    const today = dateKey();
    const [counts, activity, streak, word] = await Promise.all([
      getCounts(db, settings.widgetTrack),
      getActivityForDate(db, today),
      getStreak(db, today),
      getWordOfTheDay(db, settings.widgetTrack, today),
    ]);

    const data = {
      word,
      track: settings.widgetTrack,
      dueCount: counts.due,
      newCount: counts.fresh,
      todayDone: activity.newWords + activity.reviews,
      streak: streak.current,
      updatedAt: new Date(),
    };

    const daily = buildDailyWordProps(data, settings);
    const glance = buildGlanceProps(data, settings);

    // Loaded lazily: the widget native module is only reachable in a real iOS
    // build, and a missing module must not prevent the app from starting.
    const DailyWordWidget = require('../../widgets/DailyWordWidget')
      .default as WidgetHandle<DailyWordProps>;
    const ReviewGlanceWidget = require('../../widgets/ReviewGlanceWidget')
      .default as WidgetHandle<GlanceProps>;

    DailyWordWidget.updateSnapshot(daily);
    ReviewGlanceWidget.updateSnapshot(glance);

    // Keep one future entry so the "updated" label is not frozen if the system
    // renders the widget again after midnight without the app running.
    try {
      const nextMidnight = new Date();
      nextMidnight.setHours(24, 0, 5, 0);
      DailyWordWidget.updateTimeline([
        { date: new Date(), props: daily },
        { date: nextMidnight, props: daily },
      ]);
      ReviewGlanceWidget.updateTimeline([
        { date: new Date(), props: glance },
        { date: nextMidnight, props: glance },
      ]);
    } catch {
      // Timeline scheduling is best-effort; the snapshot above is the main path.
    }

    return { ok: true };
  } catch (error) {
    // Expected in Expo Go / simulator without the native widget target. The app
    // must keep working; the Settings screen shows the diagnostic.
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'Không cập nhật được widget.',
    };
  }
}

/** Small helper for the Settings screen diagnostic line. */
export function widgetSyncTimestamp(): string {
  return nowIso();
}

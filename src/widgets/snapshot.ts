import { TRACK_LABELS, type Settings, type Track, type Word } from '../types';

/**
 * Widget props must be plain serializable data: the widget runs in a separate
 * JS runtime and cannot read SQLite, React state or the app's sandbox.
 */

export interface DailyWordProps {
  term: string;
  ipa: string;
  meaningVi: string;
  exampleEn: string;
  trackLabel: string;
  dueCount: number;
  newCount: number;
  goalDone: number;
  goalTotal: number;
  streak: number;
  updatedLabel: string;
  isEmpty: boolean;
}

export interface GlanceProps {
  term: string;
  dueCount: number;
  newCount: number;
  goalDone: number;
  goalTotal: number;
  streak: number;
  updatedLabel: string;
  isEmpty: boolean;
}

export interface WidgetData {
  word: Word | null;
  track: Track;
  dueCount: number;
  newCount: number;
  todayDone: number;
  streak: number;
  updatedAt?: Date;
}

function timeLabel(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function buildDailyWordProps(data: WidgetData, settings: Settings): DailyWordProps {
  const word = data.word;
  return {
    term: word?.term ?? 'VocabMaster',
    ipa: word?.ipa ?? '',
    meaningVi: word?.meaningVi ?? 'Mở ứng dụng để thêm từ đầu tiên.',
    exampleEn: word?.exampleEn ?? '',
    trackLabel: TRACK_LABELS[data.track],
    dueCount: data.dueCount,
    newCount: data.newCount,
    goalDone: data.todayDone,
    goalTotal: Math.max(1, settings.dailyGoal),
    streak: data.streak,
    updatedLabel: timeLabel(data.updatedAt ?? new Date()),
    isEmpty: !word,
  };
}

export function buildGlanceProps(data: WidgetData, settings: Settings): GlanceProps {
  return {
    term: data.word?.term ?? 'VocabMaster',
    dueCount: data.dueCount,
    newCount: data.newCount,
    goalDone: data.todayDone,
    goalTotal: Math.max(1, settings.dailyGoal),
    streak: data.streak,
    updatedLabel: timeLabel(data.updatedAt ?? new Date()),
    isEmpty: !data.word,
  };
}

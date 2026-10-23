import type { SQLiteDatabase } from 'expo-sqlite';

import { DEFAULT_MUSIC_TRACK_ID, isMusicTrackId } from '../music/catalog';

import {
  DEFAULT_AI_MODEL,
  DEFAULT_GROQ_MODEL,
  DEFAULT_SETTINGS,
  LEVELS,
  RETIRED_AI_MODELS,
  type AiProvider,
  type Settings,
  type Track,
} from '../types';

/**
 * A model name saved by an older build can point at a model Google has retired;
 * such settings get the current default instead of failing on every AI request.
 */
export function sanitizeAiModel(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_AI_MODEL;
  const name = value.trim().replace(/^models\//, '');
  if (!name) return DEFAULT_AI_MODEL;
  return RETIRED_AI_MODELS.includes(name) ? DEFAULT_AI_MODEL : name;
}

/** A blank Groq model would make every request fail, so it falls back. */
export function sanitizeGroqModel(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_GROQ_MODEL;
  const name = value.trim();
  return name || DEFAULT_GROQ_MODEL;
}

export function sanitizeAiProvider(value: unknown): AiProvider {
  // Explicit Gemini choices are kept; a row saved before providers existed (or
  // a corrupted value) gets Groq, which is the default for this release.
  return value === 'gemini' ? 'gemini' : 'groq';
}

const SETTINGS_KEY = 'settings';

function asTrack(value: unknown, fallback: Track): Track {
  return value === 'ielts' || value === 'general' ? value : fallback;
}

function asNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** Merge stored values with defaults and clamp anything out of range. */
export function sanitizeSettings(raw: unknown): Settings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
  const value = raw as Partial<Settings>;

  const levelValue = typeof value.level === 'number' ? Math.round(value.level) : DEFAULT_SETTINGS.level;
  const level = LEVELS.includes(levelValue as Settings['level'])
    ? (levelValue as Settings['level'])
    : DEFAULT_SETTINGS.level;

  const weekdays = Array.isArray(value.reminderWeekdays)
    ? [...new Set(value.reminderWeekdays.filter((day): day is number => Number.isInteger(day) && day >= 1 && day <= 7))]
    : DEFAULT_SETTINGS.reminderWeekdays;

  return {
    track: asTrack(value.track, DEFAULT_SETTINGS.track),
    level,
    dailyGoal: Math.round(asNumber(value.dailyGoal, DEFAULT_SETTINGS.dailyGoal, 1, 200)),
    targetRetention: asNumber(value.targetRetention, DEFAULT_SETTINGS.targetRetention, 0.7, 0.97),
    themeMode:
      value.themeMode === 'light' || value.themeMode === 'dark' || value.themeMode === 'system'
        ? value.themeMode
        : DEFAULT_SETTINGS.themeMode,
    ttsAccent: value.ttsAccent === 'en-GB' ? 'en-GB' : 'en-US',
    ttsVoice:
      value.ttsVoice === 'female' || value.ttsVoice === 'male' ? value.ttsVoice : 'auto',
    remindersEnabled: Boolean(value.remindersEnabled),
    reminderHour: Math.round(asNumber(value.reminderHour, DEFAULT_SETTINGS.reminderHour, 0, 23)),
    reminderMinute: Math.round(
      asNumber(value.reminderMinute, DEFAULT_SETTINGS.reminderMinute, 0, 59),
    ),
    reminderWeekdays: weekdays.length > 0 ? weekdays.sort((a, b) => a - b) : DEFAULT_SETTINGS.reminderWeekdays,
    onboardingDone: Boolean(value.onboardingDone),
    widgetTrack: asTrack(value.widgetTrack, DEFAULT_SETTINGS.widgetTrack),
    aiProvider: sanitizeAiProvider(value.aiProvider),
    aiModel: sanitizeAiModel(value.aiModel),
    groqModel: sanitizeGroqModel(value.groqModel),
    // A row saved before music existed gets the new default (on); an explicit
    // "off" is always respected.
    musicEnabled:
      value.musicEnabled === undefined ? DEFAULT_SETTINGS.musicEnabled : Boolean(value.musicEnabled),
    musicTrackId: isMusicTrackId(value.musicTrackId)
      ? value.musicTrackId
      : DEFAULT_MUSIC_TRACK_ID,
    musicVolume: asNumber(value.musicVolume, DEFAULT_SETTINGS.musicVolume, 0, 1),
    musicMuted: Boolean(value.musicMuted),
    bestAsteroid: Math.round(asNumber(value.bestAsteroid, 0, 0, 1_000_000)),
    bestRush: Math.round(asNumber(value.bestRush, 0, 0, 1_000_000)),
    bestMemory: Math.round(asNumber(value.bestMemory, 0, 0, 1_000_000)),
  };
}

export async function loadSettings(db: SQLiteDatabase): Promise<Settings> {
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_settings WHERE key = ?;',
    [SETTINGS_KEY],
  );
  if (!row) return { ...DEFAULT_SETTINGS };
  try {
    return sanitizeSettings(JSON.parse(row.value));
  } catch {
    // Corrupted row: fall back to defaults instead of crashing the app.
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(db: SQLiteDatabase, settings: Settings): Promise<Settings> {
  const clean = sanitizeSettings(settings);
  await db.runAsync(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
    [SETTINGS_KEY, JSON.stringify(clean)],
  );
  return clean;
}

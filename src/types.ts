/**
 * Domain types shared by the database layer, the learning engine, the UI and
 * the widget snapshot builder. Keep this file free of React Native imports so
 * it can be unit-tested and reused by the widget bundle.
 */

export type Track = 'general' | 'ielts';

/** 0 = starter (mất gốc), 1..6 = A1, A2, B1, B2, C1, C2. */
export type Level = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type WordSource = 'manual' | 'ai' | 'seed' | 'import' | 'dictionary';

/**
 * Optional word fields a dictionary may not provide. Stored with the word so
 * the UI can say "thiếu IPA" instead of pretending the data is complete.
 */
export type WordField =
  | 'ipa'
  | 'audio'
  | 'partOfSpeech'
  | 'meaningVi'
  | 'definitionEn'
  | 'exampleEn'
  | 'synonyms';

export type LearningState = 'new' | 'learning' | 'review' | 'relearning' | 'known';

/** 1 = Again, 2 = Hard, 3 = Good, 4 = Easy (FSRS ratings). */
export type ReviewRating = 1 | 2 | 3 | 4;

export const TRACKS: readonly Track[] = ['general', 'ielts'];

export const LEVELS: readonly Level[] = [0, 1, 2, 3, 4, 5, 6];

export const LEVEL_LABELS: Record<Level, string> = {
  0: 'Level 0 · Nhập môn',
  1: 'Level 1 · A1',
  2: 'Level 2 · A2',
  3: 'Level 3 · B1',
  4: 'Level 4 · B2',
  5: 'Level 5 · C1',
  6: 'Level 6 · C2',
};

export const LEVEL_SHORT: Record<Level, string> = {
  0: 'Starter',
  1: 'A1',
  2: 'A2',
  3: 'B1',
  4: 'B2',
  5: 'C1',
  6: 'C2',
};

export const TRACK_LABELS: Record<Track, string> = {
  general: 'General English',
  ielts: 'IELTS Vocabulary',
};

export interface Word {
  id: string;
  term: string;
  /** Lowercase, punctuation-free form used for duplicate detection/search. */
  normalizedTerm: string;
  ipa: string | null;
  partOfSpeech: string | null;
  meaningVi: string;
  definitionEn: string | null;
  exampleEn: string | null;
  exampleVi: string | null;
  synonyms: string[];
  antonyms: string[];
  collocations: string[];
  wordFamily: string[];
  topic: string | null;
  track: Track;
  level: Level;
  source: WordSource;
  /** True when the row originated from Gemini, even after user edits. */
  aiGenerated: boolean;
  /** False until the user saves/accepts an AI suggestion. */
  confirmed: boolean;
  note: string | null;
  audioUrl: string | null;
  /** "minhqnd+wiktionary" for looked-up words; null for hand-made ones. */
  dictSource?: string | null;
  /** Fields the lookup could not fill; empty means complete. */
  missingFields?: WordField[];
  isFavorite: boolean;
  learningState: LearningState;
  /** ISO timestamp of the next scheduled review. Null for never-reviewed words. */
  dueAt: string | null;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  lastReviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Fields a user (or the AI) can provide when creating a word. */
export interface WordInput {
  term: string;
  ipa?: string | null;
  partOfSpeech?: string | null;
  meaningVi: string;
  definitionEn?: string | null;
  exampleEn?: string | null;
  exampleVi?: string | null;
  synonyms?: string[];
  antonyms?: string[];
  collocations?: string[];
  wordFamily?: string[];
  topic?: string | null;
  track?: Track;
  level?: Level;
  source?: WordSource;
  note?: string | null;
  audioUrl?: string | null;
  dictSource?: string | null;
  missingFields?: WordField[];
  isFavorite?: boolean;
  aiGenerated?: boolean;
  confirmed?: boolean;
}

export interface ReviewLog {
  id: string;
  wordId: string;
  rating: ReviewRating;
  correct: boolean;
  mode: QuizKind | 'manual';
  durationMs: number;
  reviewedAt: string;
  previousIntervalDays: number;
  nextIntervalDays: number;
}

export interface DailyActivity {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  newWords: number;
  reviews: number;
  answered: number;
  correct: number;
  goalMet: boolean;
}

export type QuizKind =
  | 'en_to_vi'
  | 'vi_to_en'
  | 'typing'
  | 'cloze'
  | 'context'
  | 'listening'
  | 'speaking'
  | 'confusable'
  | 'recall';

export interface QuizOption {
  /** Word id for meaning/word options, or a synthetic value for cloze options. */
  id: string;
  label: string;
}

export interface QuizQuestion {
  id: string;
  wordId: string;
  kind: QuizKind;
  /** Main prompt shown to the learner. */
  prompt: string;
  /** Secondary line (e.g. the Vietnamese meaning when asking for English). */
  helper: string | null;
  example: string | null;
  options: QuizOption[] | null;
  /** Normalized accepted answer (for typing/speaking) or option id. */
  answerId: string | null;
  answerText: string;
  /** Extra accepted spellings, already normalized. */
  accepted: string[];
  word: Word;
}

export type ThemeMode = 'system' | 'light' | 'dark';

export interface Settings {
  track: Track;
  level: Level;
  /** New words per day target. */
  dailyGoal: number;
  /** Desired retention used by the scheduler (0.7 - 0.97). */
  targetRetention: number;
  themeMode: ThemeMode;
  ttsAccent: 'en-US' | 'en-GB';
  remindersEnabled: boolean;
  reminderHour: number;
  reminderMinute: number;
  /** Expo weekday numbers: 1 = Sunday ... 7 = Saturday. */
  reminderWeekdays: number[];
  onboardingDone: boolean;
  /** Track whose daily word is shown in the widgets. */
  widgetTrack: Track;
  aiModel: string;
}

/**
 * Model Gemini mặc định.
 *
 * Google đã ngừng cấp `gemini-2.5-flash` cho key mới: gọi model đó trả về 404
 * "no longer available to new users". Đổi sang model Google chỉ định trong
 * thông báo lỗi. Khi Google ngừng model này, app tự chuyển model khả dụng
 * (xem `generateVocabulary`) nên không cần cài lại bản mới.
 */
export const DEFAULT_AI_MODEL = 'gemini-3.8-flash';

/**
 * Model đã bị Google ngừng. Cài đặt cũ còn lưu những tên này sẽ được nâng lên
 * `DEFAULT_AI_MODEL` khi đọc, nếu không người dùng nâng cấp app vẫn gặp lỗi 404.
 */
export const RETIRED_AI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'];

export const DEFAULT_SETTINGS: Settings = {
  track: 'general',
  level: 2,
  dailyGoal: 10,
  targetRetention: 0.9,
  themeMode: 'system',
  ttsAccent: 'en-US',
  remindersEnabled: false,
  reminderHour: 20,
  reminderMinute: 0,
  reminderWeekdays: [2, 3, 4, 5, 6, 7, 1],
  onboardingDone: false,
  widgetTrack: 'general',
  aiModel: DEFAULT_AI_MODEL,
};

export interface DailyStats {
  dueCount: number;
  newCount: number;
  learnedCount: number;
  totalCount: number;
  streak: number;
  bestStreak: number;
  todayNewWords: number;
  todayReviews: number;
  todayAnswered: number;
  todayCorrect: number;
  accuracy7d: number;
  activeDays: string[];
  goalMetToday: boolean;
}

export interface BackupPayload {
  format: 'vocabmaster-backup';
  version: 1;
  exportedAt: string;
  settings: Settings;
  words: Word[];
  reviews: ReviewLog[];
  activity: DailyActivity[];
}

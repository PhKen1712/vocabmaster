/**
 * Chuyển đổi giữa dữ liệu SQLite trên máy và dữ liệu trên Supabase.
 *
 * Toàn bộ file này là hàm thuần (không React Native, không mạng, không SQLite)
 * nên kiểm thử được bằng Jest và dùng chung cho iOS lẫn web. Nhờ vậy quy tắc
 * "gói tin đến muộn không được làm lùi tiến độ" có test thật, thay vì tin vào
 * cảm giác là nó đúng.
 */

import type { LearningState, ReviewRating } from '../types';
import type { ActivityRow, ReviewRow, WordRow } from '../db/schema';

export interface TermPush {
  term: string;
  track: string;
  ipa: string | null;
  partOfSpeech: string | null;
  meaningVi: string;
  definitionEn: string | null;
  exampleEn: string | null;
  exampleVi: string | null;
  synonyms: string[];
  antonyms: string[];
  collocations: string[];
  wordFamilyText: string | null;
  level: number;
  levelSource: string;
  source: string;
  aiGenerated: boolean;
}

export interface ProgressPush {
  term: string;
  track: string;
  learningState: LearningState;
  dueAt: string | null;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  correctCount: number;
  wrongCount: number;
  hintCount: number;
  lastCorrectAt: string | null;
  lastWrongAt: string | null;
  memoryRating: number | null;
  isFavorite: boolean;
  /**
   * Lúc người dùng thật sự bấm yêu thích/bỏ yêu thích; null = máy này chưa từng
   * thao tác. Server dùng nó để một máy vừa đăng nhập không xoá mất lựa chọn
   * của máy khác (xem `progressPatch` và `sync_push`).
   */
  favoriteAt: string | null;
  updatedAt: string;
}

export interface ReviewPush {
  id: string;
  term: string;
  track: string;
  rating: number;
  correct: boolean;
  mode: string;
  cycleId: string | null;
  reviewedAt: string;
}

export interface ActivityPush {
  day: string;
  newWords: number;
  reviews: number;
  answered: number;
  correct: number;
  /**
   * Ngày này đã hoàn thành mục tiêu ngày hay chưa.
   *
   * Phải gửi lên server vì server KHÔNG tự suy ra được: mục tiêu là cài đặt cá
   * nhân và có thể đổi theo thời gian, còn ngày đã đạt mục tiêu thì không đổi.
   * Thiếu trường này, bảng quản trị không thể biết chuỗi ngày thật của người
   * học — trước đây nó luôn hiện 0 vì cột `streak` không bao giờ được gửi.
   */
  goalMet: boolean;
}

export interface AlbumPush {
  clientId: string;
  name: string;
  notifyEnabled: boolean;
  intervalMinutes: number;
  startHour: number;
  endHour: number;
}

export interface AlbumItemPush {
  term: string;
  track: string;
  addedAt: string;
  deletedAt: string | null;
  lastNotifiedAt: string | null;
  notifyCount: number;
}

export interface CoinPush {
  amount: number;
  sourceId: string;
  reason: string | null;
  cycleId: string | null;
  createdAt: string;
}

export interface SyncPayload {
  terms: TermPush[];
  user_words: ProgressPush[];
  reviews: ReviewPush[];
  daily_activity: ActivityPush[];
  album: AlbumPush | null;
  album_items: AlbumItemPush[];
  coins: CoinPush[];
  settings?: Record<string, unknown>;
}

export function emptyPayload(): SyncPayload {
  return {
    terms: [],
    user_words: [],
    reviews: [],
    daily_activity: [],
    album: null,
    album_items: [],
    coins: [],
  };
}

/** Bỏ đuôi Z/giây lẻ để so sánh được cả hai kiểu thời gian (ISO và timestamptz). */
export function timeValue(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function isNewer(incoming: string | null | undefined, current: string | null | undefined): boolean {
  return timeValue(incoming) >= timeValue(current);
}

/** Bao lâu thì xem lại dữ liệu gần đây khi kéo về (xem `recheckSince`). */
export const RECHECK_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Lùi mốc kéo về một cửa sổ.
 *
 * Vì sao cần: nếu chỉ hỏi "những gì mới hơn mốc lần trước", một dòng đã bị máy
 * khác ghi đè sai sẽ KHÔNG bao giờ quay lại để máy này sửa — máy này giữ giá trị
 * đúng, nhưng máy chủ (và do đó thiết bị thứ ba) giữ giá trị sai mãi mãi. Hỏi
 * lại một cửa sổ gần đây thì mọi phép trộn đều idempotent nên chỉ tốn vài dòng
 * dữ liệu, đổi lại hai bên tự khớp lại được.
 */
export function recheckSince(
  watermark: string | null | undefined,
  windowMs: number = RECHECK_WINDOW_MS,
): string | null {
  if (!watermark) return null;
  const time = Date.parse(watermark);
  if (Number.isNaN(time)) return null;
  return new Date(time - windowMs).toISOString();
}

export function parseList(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function termFromWord(row: WordRow): TermPush {
  return {
    term: row.term,
    track: row.track === 'ielts' ? 'ielts' : 'general',
    ipa: row.ipa,
    partOfSpeech: row.part_of_speech,
    meaningVi: row.meaning_vi ?? '',
    definitionEn: row.definition_en,
    exampleEn: row.example_en,
    exampleVi: row.example_vi,
    synonyms: parseList(row.synonyms),
    antonyms: parseList(row.antonyms),
    collocations: parseList(row.collocations),
    wordFamilyText: parseList(row.word_family).join('; ') || null,
    level: row.level,
    // Server chỉ nhận 4 giá trị: ai | pack | settings | import.
    levelSource:
      row.source === 'seed' ? 'pack' : row.source === 'import' ? 'import' : row.ai_generated ? 'ai' : 'import',
    source: row.source,
    aiGenerated: row.ai_generated === 1,
  };
}

export function progressFromWord(row: WordRow): ProgressPush {
  return {
    term: row.term,
    track: row.track === 'ielts' ? 'ielts' : 'general',
    learningState: (row.learning_state as LearningState) ?? 'new',
    dueAt: row.due_at,
    stability: row.stability ?? 0,
    difficulty: row.difficulty ?? 0,
    reps: row.reps ?? 0,
    lapses: row.lapses ?? 0,
    correctCount: row.correct_count ?? 0,
    wrongCount: row.wrong_count ?? 0,
    hintCount: row.hint_count ?? 0,
    lastCorrectAt: row.last_correct_at ?? null,
    lastWrongAt: row.last_wrong_at ?? null,
    memoryRating: row.memory_rating ?? null,
    isFavorite: row.is_favorite === 1,
    favoriteAt: row.favorite_at ?? null,
    updatedAt: row.updated_at,
  };
}

export function reviewFromRow(row: ReviewRow, term: string, track: string): ReviewPush {
  return {
    id: row.id,
    term,
    track,
    rating: row.rating,
    correct: row.correct === 1,
    mode: row.mode,
    cycleId: null,
    reviewedAt: row.reviewed_at,
  };
}

export function activityFromRow(row: ActivityRow): ActivityPush {
  return {
    day: row.date,
    newWords: row.new_words,
    reviews: row.reviews,
    answered: row.answered,
    correct: row.correct,
    goalMet: row.goal_met === 1,
  };
}

export function albumFromSettings(
  settings: {
    albumNotifyEnabled: boolean;
    albumIntervalMinutes: number;
    albumStartHour: number;
    albumEndHour: number;
  },
  clientId: string,
): AlbumPush {
  return {
    clientId,
    name: 'Album của tôi',
    notifyEnabled: settings.albumNotifyEnabled,
    intervalMinutes: settings.albumIntervalMinutes,
    startHour: settings.albumStartHour,
    endHour: settings.albumEndHour,
  };
}

export function albumItemFromRow(
  row: { word_id: string; added_at: string; last_notified_at: string | null; notify_count: number },
  term: string,
  track: string,
  deletedAt: string | null = null,
): AlbumItemPush {
  return {
    term,
    track,
    addedAt: row.added_at,
    deletedAt,
    lastNotifiedAt: row.last_notified_at,
    notifyCount: row.notify_count,
  };
}

export function coinFromRow(row: {
  amount: number;
  source_id: string | null;
  reason: string | null;
  cycle_id: string | null;
  created_at: string;
  kind: string;
}): CoinPush | null {
  // Dòng 0 xu là dấu "đã thưởng" của phiên bản cũ, không phải giao dịch thật.
  if (!row.source_id || row.amount === 0) return null;
  if (row.kind !== 'reward' && row.kind !== 'penalty') return null;
  return {
    amount: row.amount,
    sourceId: row.source_id,
    reason: row.reason,
    cycleId: row.cycle_id,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Chiều kéo về
// ---------------------------------------------------------------------------

export interface PulledWord {
  termId: string;
  term: string;
  normalizedTerm: string;
  track?: string;
  ipa: string | null;
  partOfSpeech: string | null;
  meaningVi: string | null;
  definitionEn: string | null;
  exampleEn: string | null;
  exampleVi: string | null;
  synonyms: string[] | null;
  antonyms: string[] | null;
  collocations: string[] | null;
  wordFamilyText: string | null;
  level: number;
  levelSource: string;
  learningState: string;
  dueAt: string | null;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  correctCount: number;
  wrongCount: number;
  hintCount: number;
  lastCorrectAt: string | null;
  lastWrongAt: string | null;
  memoryRating: number | null;
  isFavorite: boolean;
  favoriteAt?: string | null;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ProgressPatch {
  learningState: LearningState;
  dueAt: string | null;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  correctCount: number;
  wrongCount: number;
  hintCount: number;
  lastCorrectAt: string | null;
  lastWrongAt: string | null;
  memoryRating: number | null;
  isFavorite: boolean;
  /** Xem `decideFavorite`: đây mới là thứ quyết định ai thắng. */
  favoriteAt: string | null;
  updatedAt: string;
}

/**
 * Ai thắng khi hai thiết bị nói khác nhau về trạng thái yêu thích?
 *
 * - Máy đến mà KHÔNG có mốc thao tác → không được đổi gì (máy mới chưa từng
 *   biết về từ này, `false` của nó không phải là một quyết định).
 * - Máy này chưa từng thao tác → nhận giá trị đến.
 * - Cả hai đều đã thao tác → bản mới hơn thắng, nên bỏ yêu thích vẫn lan sang
 *   thiết bị khác được.
 */
export function decideFavorite(input: {
  localValue: boolean;
  localAt: string | null;
  remoteValue: boolean;
  remoteAt: string | null;
}): { value: boolean; at: string | null } {
  const { localValue, localAt, remoteValue, remoteAt } = input;
  if (!remoteAt) return { value: localValue, at: localAt };
  if (!localAt) return { value: remoteValue, at: remoteAt };
  if (timeValue(remoteAt) >= timeValue(localAt)) return { value: remoteValue, at: remoteAt };
  return { value: localValue, at: localAt };
}

function asLearningState(value: string): LearningState {
  if (value === 'learning' || value === 'review' || value === 'relearning' || value === 'known') {
    return value;
  }
  return 'new';
}

function asRating(value: number | null): ReviewRating | null {
  if (value === 1 || value === 2 || value === 3 || value === 4) return value;
  return null;
}

/**
 * Quyết định có áp tiến độ đến từ server hay không.
 *
 * Quy tắc: bộ đếm CHỈ TĂNG (một gói tin đến muộn không được xoá thành tích),
 * còn trạng thái và lịch ôn lấy theo bản `updated_at` mới hơn. Trả về null khi
 * không có gì để ghi — nhờ vậy vòng lặp đồng bộ không ghi database vô ích.
 */
export function progressPatch(
  local: WordRow | null,
  incoming: PulledWord,
  now: string = new Date().toISOString(),
): ProgressPatch | null {
  const base: ProgressPatch = {
    learningState: asLearningState(incoming.learningState),
    dueAt: incoming.dueAt,
    stability: incoming.stability ?? 0,
    difficulty: incoming.difficulty ?? 0,
    reps: incoming.reps ?? 0,
    lapses: incoming.lapses ?? 0,
    correctCount: incoming.correctCount ?? 0,
    wrongCount: incoming.wrongCount ?? 0,
    hintCount: incoming.hintCount ?? 0,
    lastCorrectAt: incoming.lastCorrectAt,
    lastWrongAt: incoming.lastWrongAt,
    memoryRating: asRating(incoming.memoryRating),
    isFavorite: incoming.isFavorite === true,
    favoriteAt: incoming.favoriteAt ?? null,
    updatedAt: incoming.updatedAt,
  };

  if (!local) return base;

  const favorite = decideFavorite({
    localValue: local.is_favorite === 1,
    localAt: local.favorite_at ?? null,
    remoteValue: incoming.isFavorite === true,
    remoteAt: incoming.favoriteAt ?? null,
  });

  // Tự chữa lành: máy chủ đang giữ giá trị khác mà KHÔNG có mốc thao tác nào
  // (dữ liệu cũ, hoặc đã bị máy khác ghi đè trước khi có bản vá này). Giữ lựa
  // chọn của máy này và đóng mốc mới để nó được đẩy lại lên — nếu không, máy
  // chủ sẽ giữ giá trị sai mãi và thiết bị thứ ba sẽ nhìn thấy giá trị sai đó.
  const reassertLocalFavorite =
    !incoming.favoriteAt && favorite.value && incoming.isFavorite !== true;

  const scheduleWins = isNewer(incoming.updatedAt, local.updated_at);
  const merged: ProgressPatch = {
    learningState: scheduleWins ? base.learningState : asLearningState(local.learning_state),
    dueAt: scheduleWins ? base.dueAt : local.due_at,
    stability: scheduleWins ? base.stability : (local.stability ?? 0),
    difficulty: scheduleWins ? base.difficulty : (local.difficulty ?? 0),
    reps: Math.max(base.reps, local.reps ?? 0),
    lapses: Math.max(base.lapses, local.lapses ?? 0),
    correctCount: Math.max(base.correctCount, local.correct_count ?? 0),
    wrongCount: Math.max(base.wrongCount, local.wrong_count ?? 0),
    hintCount: Math.max(base.hintCount, local.hint_count ?? 0),
    lastCorrectAt: laterOf(base.lastCorrectAt, local.last_correct_at ?? null),
    lastWrongAt: laterOf(base.lastWrongAt, local.last_wrong_at ?? null),
    memoryRating: scheduleWins ? base.memoryRating : asRating(local.memory_rating ?? null),
    isFavorite: favorite.value,
    favoriteAt: reassertLocalFavorite ? now : favorite.at,
    updatedAt: scheduleWins ? incoming.updatedAt : local.updated_at,
  };

  const changed =
    merged.learningState !== asLearningState(local.learning_state) ||
    timeValue(merged.dueAt) !== timeValue(local.due_at) ||
    merged.correctCount !== (local.correct_count ?? 0) ||
    merged.wrongCount !== (local.wrong_count ?? 0) ||
    merged.hintCount !== (local.hint_count ?? 0) ||
    merged.reps !== (local.reps ?? 0) ||
    merged.lapses !== (local.lapses ?? 0) ||
    merged.isFavorite !== (local.is_favorite === 1) ||
    merged.favoriteAt !== (local.favorite_at ?? null) ||
    merged.memoryRating !== asRating(local.memory_rating ?? null) ||
    timeValue(merged.lastCorrectAt) !== timeValue(local.last_correct_at) ||
    timeValue(merged.lastWrongAt) !== timeValue(local.last_wrong_at);

  return changed ? merged : null;
}

export function laterOf(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return timeValue(a) >= timeValue(b) ? a : b;
}

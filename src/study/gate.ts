import type { SQLiteDatabase } from 'expo-sqlite';

import { nowIso } from '../lib/ids';
import type { Track } from '../types';

/**
 * One rule: while any word is due for review, the learner may not *start
 * learning* a new word. Adding, editing or generating vocabulary is a separate
 * activity and must always be allowed — collecting a word for later is not the
 * same as studying it.
 *
 * Only new-learning sessions are gated. Adding a word keeps
 * `learningState: 'new'` and `dueAt: null`, so it cannot enter the review queue
 * just because it was saved.
 */

/** Business actions that could be limited by pending reviews. */
export type StudyAction =
  | 'addVocabulary'
  | 'generateContent'
  | 'startNewLearning'
  | 'startReview'
  | 'practiceKnown';

/**
 * The single policy used by screens and tests. Adding/editing/generating words
 * is never blocked; only a session that introduces new words is.
 */
export function requiresReviewsComplete(action: StudyAction): boolean {
  return action === 'startNewLearning';
}

export class ReviewsDueError extends Error {
  readonly dueCount: number;

  constructor(dueCount: number) {
    super(`Bạn còn ${dueCount} từ cần ôn. Hoàn thành ôn tập trước khi bắt đầu học từ mới.`);
    this.name = 'ReviewsDueError';
    this.dueCount = dueCount;
  }
}

export interface StudyGate {
  dueCount: number;
  newLearningBlocked: boolean;
}

export async function countDueWords(db: SQLiteDatabase, track: Track): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM words
     WHERE track = ? AND reps > 0 AND due_at IS NOT NULL AND due_at <= ?;`,
    [track, nowIso()],
  );
  return row?.count ?? 0;
}

export async function getStudyGate(db: SQLiteDatabase, track: Track): Promise<StudyGate> {
  const dueCount = await countDueWords(db, track);
  return { dueCount, newLearningBlocked: dueCount > 0 };
}

export async function assertNewLearningAllowed(
  db: SQLiteDatabase,
  track: Track,
): Promise<void> {
  const dueCount = await countDueWords(db, track);
  if (dueCount > 0) throw new ReviewsDueError(dueCount);
}

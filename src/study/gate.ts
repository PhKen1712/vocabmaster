import type { SQLiteDatabase } from 'expo-sqlite';

import { nowIso } from '../lib/ids';
import type { Track } from '../types';

/**
 * One rule, enforced at the data layer: while any word is due for review, the
 * learner cannot add new words or start a mode that introduces them.
 *
 * The UI uses the same numbers to explain the block, but hiding a button is
 * never the only protection: `createWord` calls `assertNewLearningAllowed`
 * itself, so a new screen, a future deep link or an AI batch cannot bypass it.
 */

export class ReviewsDueError extends Error {
  readonly dueCount: number;

  constructor(dueCount: number) {
    super(
      `Bạn còn ${dueCount} từ cần ôn. Hoàn thành ôn tập trước khi học hoặc thêm từ mới.`,
    );
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

import type { SQLiteDatabase } from 'expo-sqlite';

import { nowIso } from '../lib/ids';

/**
 * Reset learning progress without losing the learner's library.
 *
 * Kept on purpose:
 * - every word, its meaning, examples, topic, level and source;
 * - album membership;
 * - coin ledger (only the balance is never touched);
 * - streak and daily activity (the learner asked to keep the streak);
 * - settings.
 *
 * Cleared:
 * - review log for the old cycle;
 * - SRS state (scheduled review, stability, difficulty, reps, lapses);
 * - correct/wrong/hint counters and self-ratings;
 * - "ever studied" history, so a new cycle starts clean and the first wrong
 *   answer on a re-learned word is not treated as a review mistake.
 *
 * Coins already earned stay in the wallet and in the ledger. The caller starts
 * a new `studyCycleId`, which lets the first correct answer of the new cycle
 * pay again once per term.
 */
export interface ResetStudyResult {
  wordsReset: number;
  reviewsDeleted: number;
}

export async function resetStudyProgress(db: SQLiteDatabase): Promise<ResetStudyResult> {
  let wordsReset = 0;
  let reviewsDeleted = 0;

  await db.withTransactionAsync(async () => {
    const reviewRow = await db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM reviews;',
    );
    reviewsDeleted = reviewRow?.count ?? 0;

    await db.execAsync('DELETE FROM reviews;');
    await db.execAsync('DELETE FROM word_study_history;');

    const result = await db.runAsync(
      `UPDATE words SET
        learning_state = 'new',
        due_at = NULL,
        stability = 0,
        difficulty = 0,
        reps = 0,
        lapses = 0,
        last_reviewed_at = NULL,
        correct_count = 0,
        wrong_count = 0,
        hint_count = 0,
        last_correct_at = NULL,
        last_wrong_at = NULL,
        memory_rating = NULL,
        updated_at = ?;`,
      nowIso(),
    );
    wordsReset = result.changes;
  });

  return { wordsReset, reviewsDeleted };
}

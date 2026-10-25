import type { Word } from '../types';

/**
 * Question priority for review sessions.
 *
 * The scheduler decides *when* a word is due; this decides *which* of the due
 * words get asked first when a session is shorter than the queue. It is a pure
 * score so it can be unit-tested and never depends on a screen being visible.
 *
 * High score = ask sooner:
 * - overdue words always outrank anything that is not due;
 * - frequent wrong answers, lapses, low self-ratings and hint use raise it;
 * - a recent correct answer lowers it, so one easy word does not dominate the
 *   start of every session.
 */
export function priorityScore(word: Word, now: number = Date.now()): number {
  let score = 0;

  if (word.dueAt) {
    const due = new Date(word.dueAt).getTime();
    if (Number.isFinite(due)) {
      if (due <= now) {
        const overdueDays = (now - due) / 86_400_000;
        score += 1_000 + Math.min(300, overdueDays * 25);
      } else {
        // Not due yet: still rank it below every due word, but a word that is
        // due in an hour is more urgent than one due next month.
        const daysAway = (due - now) / 86_400_000;
        score -= Math.min(250, daysAway * 3);
      }
    }
  }

  const correct = Math.max(0, word.correctCount ?? 0);
  const wrong = Math.max(0, word.wrongCount ?? 0);
  const attempts = correct + wrong;
  if (attempts > 0) score += (wrong / attempts) * 300;
  score += Math.min(180, wrong * 18);
  score += Math.min(120, Math.max(0, word.lapses) * 12);
  score += Math.min(60, Math.max(0, word.hintCount ?? 0) * 8);

  if (word.memoryRating === 1) score += 150;
  else if (word.memoryRating === 2) score += 80;
  else if (word.memoryRating === 4) score -= 60;

  if (word.lastWrongAt) {
    const wrongAt = new Date(word.lastWrongAt).getTime();
    if (Number.isFinite(wrongAt) && now - wrongAt < 24 * 3_600_000) score += 55;
  }
  if (word.lastCorrectAt && wrong === 0) {
    const correctAt = new Date(word.lastCorrectAt).getTime();
    if (Number.isFinite(correctAt) && now - correctAt < 6 * 3_600_000) score -= 45;
  }
  // A short cooldown keeps the same hard word from opening every single session
  // while still leaving an overdue word far above everything else.
  if (word.lastReviewedAt) {
    const reviewedAt = new Date(word.lastReviewedAt).getTime();
    if (Number.isFinite(reviewedAt) && now - reviewedAt < 30 * 60_000) score -= 60;
  }

  // Never let a brand-new word jump ahead of an overdue review; it only gets a
  // small nudge among other new words.
  if (word.reps === 0) score += 15;

  return score;
}

/** Highest priority first. Stable for equal scores. */
export function sortWordsByPriority(words: readonly Word[], now: number = Date.now()): Word[] {
  return [...words].sort((a, b) => priorityScore(b, now) - priorityScore(a, now));
}

/** A word belongs in "Từ tôi hay quên" only after it has actually been studied. */
export function isForgettable(word: Word): boolean {
  if (word.reps === 0) return false;
  const wrong = word.wrongCount ?? 0;
  return wrong > 0 || word.lapses > 0 || word.memoryRating === 1 || word.memoryRating === 2;
}

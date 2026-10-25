/**
 * Pick the next album word for a notification.
 *
 * This is a weighted random draw, not a fixed A–Z rotation:
 * - words never notified (or not for a long time) get a much larger weight;
 * - a word already sent many times loses weight;
 * - the previous word is excluded while the album has alternatives, so the
 *   same card is not shown twice in a row.
 *
 * Weights are applied with the Efraimidis–Spirakis key (`rng() ** (1/w)`); the
 * largest key wins, which samples proportionally to the weights without
 * building a giant list of notification slots in advance.
 */
export interface AlbumSelectionCandidate {
  id: string;
  lastNotifiedAt: string | null;
  notifyCount: number;
}

const DAY_MS = 86_400_000;

function weightOf(candidate: AlbumSelectionCandidate, now: number, maxCount: number): number {
  const last = candidate.lastNotifiedAt ? new Date(candidate.lastNotifiedAt).getTime() : NaN;
  const daysSince = Number.isFinite(last) ? Math.max(0, (now - last) / DAY_MS) : 60;
  const freshness = Math.min(60, daysSince);
  const balance = Math.max(0, maxCount - candidate.notifyCount) * 0.8;
  return Math.max(0.05, 1 + freshness + balance);
}

export function chooseAlbumWord(
  candidates: readonly AlbumSelectionCandidate[],
  lastId: string | null,
  now: number = Date.now(),
  rng: () => number = Math.random,
): string | null {
  const usable = candidates.filter((candidate) => candidate.id);
  if (usable.length === 0) return null;
  if (usable.length === 1) return usable[0]?.id ?? null;

  const withoutLast = usable.filter((candidate) => candidate.id !== lastId);
  const pool = withoutLast.length > 0 ? withoutLast : usable;
  const maxCount = usable.reduce((max, candidate) => Math.max(max, candidate.notifyCount), 0);

  let bestId: string | null = null;
  let bestKey = -1;
  for (const candidate of pool) {
    const weight = weightOf(candidate, now, maxCount);
    const key = Math.pow(Math.max(1e-9, rng()), 1 / weight);
    if (key > bestKey) {
      bestKey = key;
      bestId = candidate.id;
    }
  }
  return bestId;
}

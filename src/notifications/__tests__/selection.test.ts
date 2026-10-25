import { chooseAlbumWord, type AlbumSelectionCandidate } from '../selection';

const NOW = new Date('2026-10-26T10:00:00.000Z').getTime();
const DAY = 86_400_000;

function candidate(
  id: string,
  overrides: Partial<AlbumSelectionCandidate> = {},
): AlbumSelectionCandidate {
  return { id, lastNotifiedAt: null, notifyCount: 0, ...overrides };
}

describe('album notification selection', () => {
  it('returns null for an empty album and the only word for a one-word album', () => {
    expect(chooseAlbumWord([], null, NOW)).toBeNull();
    expect(chooseAlbumWord([candidate('only')], 'only', NOW)).toBe('only');
  });

  it('does not repeat the previous word while alternatives exist', () => {
    const words = [candidate('a'), candidate('b'), candidate('c')];
    for (let i = 0; i < 30; i += 1) {
      expect(chooseAlbumWord(words, 'a', NOW)).not.toBe('a');
    }
  });

  it('favours a word that has not been notified for a long time', () => {
    const old = candidate('old', {
      lastNotifiedAt: new Date(NOW - 30 * DAY).toISOString(),
      notifyCount: 8,
    });
    const fresh = candidate('fresh', {
      lastNotifiedAt: new Date(NOW - 1_000).toISOString(),
      notifyCount: 0,
    });
    let oldWins = 0;
    for (let i = 0; i < 40; i += 1) {
      if (chooseAlbumWord([old, fresh], null, NOW, () => 0.5) === 'old') oldWins += 1;
    }
    expect(oldWins).toBe(40);
  });

  it('eventually picks every word in a small album', () => {
    const words = ['a', 'b', 'c'].map((id) => candidate(id));
    const picked = new Set<string>();
    let last: string | null = null;
    for (let i = 0; i < 40; i += 1) {
      const next = chooseAlbumWord(words, last, NOW, () => Math.random());
      if (next) {
        picked.add(next);
        last = next;
      }
    }
    expect(picked.size).toBe(3);
  });
});

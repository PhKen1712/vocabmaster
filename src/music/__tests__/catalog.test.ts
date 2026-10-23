import {
  DEFAULT_MUSIC_TRACK_ID,
  MUSIC_CATALOG,
  findMusicTrack,
  foldForSearch,
  isMusicTrackId,
  searchMusic,
} from '../catalog';

describe('music catalogue', () => {
  it('ships several loops with unique ids and complete metadata', () => {
    expect(MUSIC_CATALOG.length).toBeGreaterThanOrEqual(4);
    expect(new Set(MUSIC_CATALOG.map((track) => track.id)).size).toBe(MUSIC_CATALOG.length);
    for (const track of MUSIC_CATALOG) {
      expect(track.name.trim()).toBeTruthy();
      expect(track.nameEn.trim()).toBeTruthy();
      expect(track.mood.trim()).toBeTruthy();
      expect(track.bpm).toBeGreaterThan(40);
      expect(track.seconds).toBeGreaterThan(20);
      expect(track.tags.length).toBeGreaterThan(2);
    }
  });

  it('has a default track that exists', () => {
    expect(findMusicTrack(DEFAULT_MUSIC_TRACK_ID)).not.toBeNull();
    expect(isMusicTrackId(DEFAULT_MUSIC_TRACK_ID)).toBe(true);
    expect(isMusicTrackId('not-a-track')).toBe(false);
    expect(isMusicTrackId(undefined)).toBe(false);
  });
});

describe('foldForSearch', () => {
  it('removes Vietnamese diacritics and đ', () => {
    expect(foldForSearch('Đêm lofi')).toBe('dem lofi');
    expect(foldForSearch('Thư giãn')).toBe('thu gian');
  });
});

describe('searchMusic', () => {
  it('returns the whole catalogue for an empty query', () => {
    expect(searchMusic('')).toHaveLength(MUSIC_CATALOG.length);
    expect(searchMusic('   ')).toHaveLength(MUSIC_CATALOG.length);
  });

  it('finds a track by Vietnamese name without diacritics', () => {
    expect(searchMusic('dem').map((track) => track.id)).toContain('lofi-night');
    expect(searchMusic('rung').map((track) => track.id)).toContain('focus-forest');
  });

  it('finds a track by English name, mood and tag', () => {
    expect(searchMusic('pixel').map((track) => track.id)).toEqual(['pixel-run']);
    expect(searchMusic('nang luong').map((track) => track.id)).toContain('pixel-run');
    expect(searchMusic('khong gian').map((track) => track.id)).toContain('deep-space');
  });

  it('requires every word to match, so a long query narrows the list', () => {
    const all = searchMusic('hoc');
    const narrowed = searchMusic('hoc lofi');
    expect(narrowed.length).toBeLessThanOrEqual(all.length);
    for (const track of narrowed) {
      expect(track.id).toBe('lofi-night');
    }
  });

  it('returns nothing for a query that matches no metadata', () => {
    expect(searchMusic('zydeco')).toHaveLength(0);
  });
});

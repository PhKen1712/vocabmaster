/**
 * Catalogue of the bundled background music.
 *
 * Every loop in `assets/music` is synthesised by `scripts/generate-music.mjs`,
 * so it is original work: no licence to track, no attribution screen, no
 * streaming account and no network call. This file stays free of React Native
 * imports so the search rules can be unit-tested.
 */

export interface MusicTrackMeta {
  id: string;
  name: string;
  nameEn: string;
  /** One word for the mood chip, in Vietnamese. */
  mood: string;
  bpm: number;
  seconds: number;
  description: string;
  /** Vietnamese and English words the search matches. */
  tags: string[];
}

export const MUSIC_CATALOG: MusicTrackMeta[] = [
  {
    id: 'focus-forest',
    name: 'Rừng tập trung',
    nameEn: 'Focus Forest',
    mood: 'Tập trung',
    bpm: 76,
    seconds: 50,
    description: 'Pad ấm và tiếng đàn thưa, đủ nhẹ để đọc nghĩa từ mà không bị hút mắt.',
    tags: ['tập trung', 'focus', 'calm', 'rừng', 'học', 'study', 'ambient', 'dễ chịu'],
  },
  {
    id: 'lofi-night',
    name: 'Đêm lofi',
    nameEn: 'Lo-fi Night',
    mood: 'Thư giãn',
    bpm: 70,
    seconds: 55,
    description: 'Vòng hợp âm lofi có tiếng đĩa nhẹ — hợp với ôn bài buổi tối hoặc trước khi ngủ.',
    tags: ['lofi', 'đêm', 'night', 'chill', 'thư giãn', 'học', 'study', 'mưa'],
  },
  {
    id: 'pixel-run',
    name: 'Pixel Run',
    nameEn: 'Pixel Run',
    mood: 'Năng lượng',
    bpm: 122,
    seconds: 32,
    description: 'Chiptune 8-bit nhanh, nhiều nhịp — dùng khi chơi game hoặc cần tỉnh táo.',
    tags: ['game', 'chiptune', '8-bit', 'nhanh', 'vui', 'năng lượng', 'arcade'],
  },
  {
    id: 'sunrise',
    name: 'Bình minh',
    nameEn: 'Sunrise',
    mood: 'Tươi sáng',
    bpm: 88,
    seconds: 44,
    description: 'Giai điệu sáng, nhịp vừa phải — mở app buổi sáng và bắt đầu ngày mới.',
    tags: ['sáng', 'sunrise', 'tươi', 'bright', 'vui', 'học', 'study', 'morning'],
  },
  {
    id: 'deep-space',
    name: 'Khoảng không',
    nameEn: 'Deep Space',
    mood: 'Không gian',
    bpm: 60,
    seconds: 48,
    description: 'Drone sâu với chuông thưa, viết riêng cho màn bắn thiên thạch từ vựng.',
    tags: ['không gian', 'space', 'ambient', 'sâu', 'calm', 'game', 'thiên thạch'],
  },
];

export const DEFAULT_MUSIC_TRACK_ID = 'focus-forest';

/**
 * Fold Vietnamese diacritics so "dem" finds "Đêm" and "thu gian" finds
 * "Thư giãn". Typing Vietnamese on a phone is slow; search must not require it.
 */
export function foldForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function findMusicTrack(id: string): MusicTrackMeta | null {
  return MUSIC_CATALOG.find((track) => track.id === id) ?? null;
}

export function isMusicTrackId(id: unknown): id is string {
  return typeof id === 'string' && MUSIC_CATALOG.some((track) => track.id === id);
}

/**
 * Match a track against its name (both languages), mood, description and tags.
 * An empty query returns the whole catalogue in its curated order.
 */
export function searchMusic(query: string): MusicTrackMeta[] {
  const needle = foldForSearch(query);
  if (!needle) return [...MUSIC_CATALOG];
  const words = needle.split(' ').filter(Boolean);
  return MUSIC_CATALOG.filter((track) => {
    const haystack = foldForSearch(
      [track.name, track.nameEn, track.mood, track.description, ...track.tags].join(' '),
    );
    return words.every((word) => haystack.includes(word));
  });
}

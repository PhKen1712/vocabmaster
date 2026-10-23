import type { AudioSource } from 'expo-audio';

import { MUSIC_CATALOG, findMusicTrack, type MusicTrackMeta } from './catalog';

/**
 * Metro needs a static `require` per asset, so the paths cannot be built from
 * a string at runtime. Keep this map in sync with `MUSIC_CATALOG` and
 * `scripts/generate-music.mjs`.
 */
const SOURCES: Record<string, number> = {
  'focus-forest': require('../../assets/music/focus-forest.mp3'),
  'lofi-night': require('../../assets/music/lofi-night.mp3'),
  'pixel-run': require('../../assets/music/pixel-run.mp3'),
  sunrise: require('../../assets/music/sunrise.mp3'),
  'deep-space': require('../../assets/music/deep-space.mp3'),
};

export interface MusicTrack extends MusicTrackMeta {
  source: AudioSource;
}

export const MUSIC_TRACKS: MusicTrack[] = MUSIC_CATALOG.filter(
  (track) => SOURCES[track.id] !== undefined,
).map((track) => ({ ...track, source: SOURCES[track.id] as number }));

export function musicTrack(id: string): MusicTrack {
  const meta = findMusicTrack(id) ?? MUSIC_CATALOG[0]!;
  return (
    MUSIC_TRACKS.find((track) => track.id === meta.id) ?? {
      ...meta,
      source: SOURCES[meta.id] as number,
    }
  );
}

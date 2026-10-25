import { createAudioPlayer, type AudioPlayer } from 'expo-audio';

/**
 * Short interaction sounds.
 *
 * Rules:
 * - opt-out in Settings, and the setting is independent of speech: turning
 *   effects off must never mute a vocabulary word;
 * - one player per kind, reused, so rapid taps do not create a pile of native
 *   players;
 * - a global gap plus a tiny per-sound throttle prevents overlapping noise;
 * - volume is deliberately low and the files are soft-edged, so an effect does
 *   not interrupt TTS or bury the music.
 */

export type SfxKind = 'correct' | 'wrong' | 'coin' | 'lesson' | 'streak' | 'hit';

const SOURCES: Record<SfxKind, number> = {
  correct: require('../../assets/sfx/correct.wav'),
  wrong: require('../../assets/sfx/wrong.wav'),
  coin: require('../../assets/sfx/coin.wav'),
  lesson: require('../../assets/sfx/lesson.wav'),
  streak: require('../../assets/sfx/streak.wav'),
  hit: require('../../assets/sfx/hit.wav'),
};

let enabled = true;
let volume = 0.55;
const players = new Map<SfxKind, AudioPlayer>();
let lastPlayedAt = 0;
let lastKind: SfxKind | null = null;

export function configureSfx(next: { enabled: boolean; volume: number }): void {
  enabled = next.enabled;
  volume = Math.max(0, Math.min(1, next.volume));
  for (const player of players.values()) {
    try {
      player.volume = volume;
    } catch {
      // Player released between setting changes.
    }
  }
}

export interface SfxGate {
  enabled: boolean;
  volume: number;
  lastPlayedAt: number;
  lastKind: SfxKind | null;
}

/**
 * Pure decision used by `playSfx`, exported so the no-overlap rules can be
 * tested without loading a native audio player.
 */
export function shouldPlaySfx(kind: SfxKind, now: number, gate: SfxGate): boolean {
  if (!gate.enabled || gate.volume <= 0) return false;
  const gap = kind === 'hit' ? 45 : 70;
  if (now - gate.lastPlayedAt < gap) return false;
  if (gate.lastKind === kind && now - gate.lastPlayedAt < 120) return false;
  return true;
}

function ensurePlayer(kind: SfxKind): AudioPlayer | null {
  const existing = players.get(kind);
  if (existing) return existing;
  try {
    const player = createAudioPlayer(SOURCES[kind], { updateInterval: 1_000 });
    player.volume = volume;
    players.set(kind, player);
    return player;
  } catch {
    // A missing codec or an audio-session conflict must never crash a lesson.
    return null;
  }
}

/**
 * Play one effect. Throttled: the same sound cannot retrigger within 120 ms and
 * any two effects must be at least 70 ms apart.
 */
export function playSfx(kind: SfxKind): void {
  const now = Date.now();
  if (!shouldPlaySfx(kind, now, { enabled, volume, lastPlayedAt, lastKind })) return;
  lastPlayedAt = now;
  lastKind = kind;

  const player = ensurePlayer(kind);
  if (!player) return;
  try {
    player.volume = volume;
    void player
      .seekTo(0)
      .then(() => player.play())
      .catch(() => undefined);
  } catch {
    // Ignore: audio is feedback, not a requirement for the answer to be saved.
  }
}

/** Release native players when the app unmounts (hot reload / test teardown). */
export function releaseSfx(): void {
  for (const player of players.values()) {
    try {
      player.remove();
    } catch {
      // Already released.
    }
  }
  players.clear();
}

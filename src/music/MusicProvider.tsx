import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';

import { restoreMediaAudio } from '../audio/session';
import { useApp } from '../state/AppProvider';
import { setMusicDuckHandler } from './duck';
import { musicTrack, type MusicTrack } from './tracks';

/**
 * One looping player shared by the whole app.
 *
 * Design rules:
 * - the chosen loop, the volume and the mute flag live in Settings, so they
 *   survive a restart and are included in backups;
 * - music is a background nicety, never a blocker: a player that fails to open
 *   shows one quiet line in the music screen and the rest of the app works;
 * - the loop pauses when the app leaves the foreground (no battery burn and no
 *   music over a phone call) and resumes on return only if it was enabled.
 *
 * Audio mode: the silent switch still mutes the music, and the app mixes with
 * other audio instead of stopping someone's podcast. Vocabulary TTS temporarily
 * upgrades the session to playback (see audio/session.ts) so a spoken word is
 * never silenced by the ringer switch.
 */

export interface MusicControl {
  track: MusicTrack;
  enabled: boolean;
  muted: boolean;
  volume: number;
  /** True only when sound can actually be heard right now. */
  audible: boolean;
  error: string | null;
  /** Start the loop after the first user interaction (iOS autoplay rule). */
  beginPlayback: () => void;
  togglePlay: () => void;
  selectTrack: (id: string) => void;
  setVolume: (value: number) => void;
  toggleMute: () => void;
  setEnabled: (value: boolean) => void;
}

const MusicContext = createContext<MusicControl | null>(null);

function effectiveVolume(settings: {
  musicMuted: boolean;
  musicVolume: number;
}): number {
  return settings.musicMuted ? 0 : Math.max(0, Math.min(1, settings.musicVolume));
}

export function MusicProvider({ children }: { children: React.ReactNode }) {
  const { ready, settings, updateSettings } = useApp();
  const [error, setError] = useState<string | null>(null);

  const playerRef = useRef<AudioPlayer | null>(null);
  const loadedTrackRef = useRef<string | null>(null);
  const duckedRef = useRef(false);
  /** Music never starts on a cold launch: iOS expects a user gesture first. */
  const startedRef = useRef(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  /** Speaking lowers the loop to a quiet bed instead of stopping it. */
  const applyVolume = useCallback((player: AudioPlayer | null) => {
    if (!player) return;
    const base = settingsRef.current.musicMuted ? 0 : settingsRef.current.musicVolume;
    try {
      player.volume = duckedRef.current ? base * 0.22 : base;
    } catch {
      // Player released during a fast unmount.
    }
  }, []);

  // Create the player only after settings are loaded, so it starts on the
  // learner's saved loop instead of flashing the default one.
  useEffect(() => {
    if (!ready) return;
    let player: AudioPlayer | null = null;

    try {
      player = createAudioPlayer(musicTrack(settingsRef.current.musicTrackId).source, {
        updateInterval: 2_000,
      });
      player.loop = true;
      player.volume = effectiveVolume(settingsRef.current) * (duckedRef.current ? 0.22 : 1);
      if (startedRef.current && settingsRef.current.musicEnabled) player.play();
      playerRef.current = player;
      loadedTrackRef.current = settingsRef.current.musicTrackId;
      setError(null);
    } catch {
      setError(
        'Không mở được file nhạc. Hãy thử chọn bài khác; phần học vẫn hoạt động bình thường.',
      );
    }

    void restoreMediaAudio();

    return () => {
      try {
        player?.remove();
      } catch {
        // Already released by the native side.
      }
      if (playerRef.current === player) playerRef.current = null;
      loadedTrackRef.current = null;
    };
  }, [ready]);

  // Volume and mute are separate settings: unmuting restores the slider value.
  useEffect(() => {
    applyVolume(playerRef.current);
  }, [settings.musicMuted, settings.musicVolume, ready, applyVolume]);

  // Speech calls duckMusic()/releaseMusicDuck() around every spoken word.
  useEffect(() => {
    setMusicDuckHandler((ducked) => {
      duckedRef.current = ducked;
      applyVolume(playerRef.current);
    });
    return () => setMusicDuckHandler(null);
  }, [applyVolume]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    try {
      if (settings.musicEnabled && startedRef.current) player.play();
      else player.pause();
    } catch {
      // Same as above: playback state is resynced on the next mount.
    }
  }, [settings.musicEnabled, ready]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || loadedTrackRef.current === settings.musicTrackId) return;
    loadedTrackRef.current = settings.musicTrackId;
    try {
      player.replace(musicTrack(settings.musicTrackId).source);
      player.loop = true;
      player.volume = effectiveVolume(settingsRef.current) * (duckedRef.current ? 0.22 : 1);
      if (settingsRef.current.musicEnabled && startedRef.current) player.play();
      setError(null);
    } catch {
      setError('Không đổi được bài nhạc này. Chọn bài khác hoặc thử lại sau.');
    }
  }, [settings.musicTrackId, ready]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      const player = playerRef.current;
      if (!player || !settingsRef.current.musicEnabled) return;
      try {
        if (state === 'active' && startedRef.current) player.play();
        else player.pause();
      } catch {
        // Ignore: the player will be recreated on the next mount.
      }
    });
    return () => subscription.remove();
  }, []);

  const beginPlayback = useCallback(() => {
    if (startedRef.current) return;
    // First launch: let the learner finish onboarding before any sound.
    if (!settingsRef.current.onboardingDone) return;
    startedRef.current = true;
    const player = playerRef.current;
    if (!player) return;
    try {
      if (settingsRef.current.musicEnabled) player.play();
    } catch {
      // A failed start is retried when the learner presses play.
    }
  }, []);

  const setEnabled = useCallback(
    (value: boolean) => {
      if (value) beginPlayback();
      void updateSettings({ musicEnabled: value });
    },
    [beginPlayback, updateSettings],
  );

  const togglePlay = useCallback(() => {
    beginPlayback();
    void updateSettings({ musicEnabled: !settingsRef.current.musicEnabled });
  }, [beginPlayback, updateSettings]);

  const selectTrack = useCallback(
    (id: string) => {
      // Choosing a song is an explicit request to hear it.
      beginPlayback();
      void updateSettings({ musicTrackId: id, musicEnabled: true });
    },
    [beginPlayback, updateSettings],
  );

  const setVolume = useCallback(
    (value: number) => {
      const clamped = Math.max(0, Math.min(1, Math.round(value * 100) / 100));
      if (clamped > 0) beginPlayback();
      void updateSettings({ musicVolume: clamped, musicMuted: false });
    },
    [beginPlayback, updateSettings],
  );

  const toggleMute = useCallback(() => {
    if (settingsRef.current.musicMuted) beginPlayback();
    void updateSettings({ musicMuted: !settingsRef.current.musicMuted });
  }, [beginPlayback, updateSettings]);

  const value = useMemo<MusicControl>(
    () => ({
      track: musicTrack(settings.musicTrackId),
      enabled: settings.musicEnabled,
      muted: settings.musicMuted,
      volume: settings.musicVolume,
      audible: settings.musicEnabled && !settings.musicMuted && settings.musicVolume > 0,
      error,
      beginPlayback,
      togglePlay,
      selectTrack,
      setVolume,
      toggleMute,
      setEnabled,
    }),
    [
      settings.musicTrackId,
      settings.musicEnabled,
      settings.musicMuted,
      settings.musicVolume,
      error,
      beginPlayback,
      togglePlay,
      selectTrack,
      setVolume,
      toggleMute,
      setEnabled,
    ],
  );

  return <MusicContext.Provider value={value}>{children}</MusicContext.Provider>;
}

export function useMusic(): MusicControl {
  const context = useContext(MusicContext);
  if (!context) throw new Error('useMusic must be used inside MusicProvider');
  return context;
}

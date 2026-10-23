import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * Pause state for the arcade screens.
 *
 * The engine only advances while `paused` is false, so time, timers and
 * incoming asteroids all stop together. Leaving the app (phone call, home
 * button, another app) pauses automatically instead of losing a run in the
 * background.
 */
export function useGamePause(active: boolean): {
  paused: boolean;
  toggle: () => void;
  resume: () => void;
  pause: () => void;
} {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!active) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') setPaused(true);
    });
    return () => subscription.remove();
  }, [active]);

  const toggle = useCallback(() => setPaused((value) => !value), []);
  const resume = useCallback(() => setPaused(false), []);
  const pause = useCallback(() => setPaused(true), []);

  return { paused, toggle, resume, pause };
}

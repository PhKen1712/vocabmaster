/**
 * Music ducking without an import cycle.
 *
 * `speech/tts` needs to lower the music while a word is spoken, but the music
 * player lives in React and must not be imported into the speech module.
 * MusicProvider registers a handler here; speech only flips the flag.
 */

type DuckHandler = (ducked: boolean) => void;

let handler: DuckHandler | null = null;

export function setMusicDuckHandler(next: DuckHandler | null): void {
  handler = next;
}

export function duckMusic(): void {
  handler?.(true);
}

export function releaseMusicDuck(): void {
  handler?.(false);
}

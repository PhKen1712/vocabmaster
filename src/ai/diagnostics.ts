import type { AiProvider } from '../types';
import { redactSecrets } from './errors';
import type { AiErrorCode, AiStage } from './types';

/**
 * Small in-memory log of recent Gemini calls. It exists so a learner can see
 * *where* a generation failed (DNS? 503? truncated JSON? validation?) instead
 * of only "Gemini gặp lỗi tạm thời".
 *
 * Deliberately not persisted: it survives navigation, not an app restart, and
 * it never contains the API key, request headers or personal data.
 */

export interface AiDiagnostic {
  id: number;
  at: string;
  phase: AiStage;
  outcome: 'ok' | 'retry' | 'error';
  provider: AiProvider;
  model: string;
  attempt: number;
  durationMs: number;
  /** Set on retry entries: how long the app is waiting before the next try. */
  delayMs?: number;
  code?: AiErrorCode;
  httpStatus?: number;
  detail?: string;
}

const LIMIT = 40;
let nextId = 1;
let entries: AiDiagnostic[] = [];
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // A broken subscriber must never break the API call.
    }
  }
}

export function recordDiagnostic(
  input: Omit<AiDiagnostic, 'id' | 'at' | 'provider'> & { provider?: AiProvider },
): AiDiagnostic {
  const entry: AiDiagnostic = {
    ...input,
    provider: input.provider ?? 'gemini',
    id: nextId++,
    at: new Date().toISOString(),
    ...(input.detail ? { detail: redactSecrets(input.detail).slice(0, 240) } : {}),
  };
  entries = [...entries, entry].slice(-LIMIT);
  notify();
  return entry;
}

/** Newest first, which is the order the settings screen shows. */
export function getDiagnostics(): AiDiagnostic[] {
  return [...entries].reverse();
}

export function subscribeDiagnostics(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clearDiagnostics(): void {
  entries = [];
  notify();
}

function clock(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatDiagnostic(entry: AiDiagnostic): string {
  const parts = [
    clock(entry.at),
    entry.outcome.toUpperCase(),
    entry.phase,
    entry.provider === 'groq' ? 'groq' : 'gemini',
  ];
  if (entry.httpStatus !== undefined) parts.push(`HTTP ${entry.httpStatus}`);
  if (entry.code) parts.push(entry.code);
  parts.push(entry.model || 'model?');
  if (entry.attempt > 1) parts.push(`lần ${entry.attempt}`);
  if (entry.delayMs !== undefined) {
    parts.push(`chờ ${(entry.delayMs / 1000).toFixed(1)}s`);
  } else {
    parts.push(`${(entry.durationMs / 1000).toFixed(1)}s`);
  }
  return parts.join(' · ');
}

#!/usr/bin/env node
/**
 * Synthesise the short interaction sounds in `assets/sfx`.
 *
 * They are generated here instead of downloaded so the app ships only original
 * audio: no licence, no attribution, no network. Each sound is deliberately
 * quiet, short and soft-edged so it never startles the learner or competes with
 * speech. Re-run with `node scripts/generate-sfx.mjs` after changing a recipe.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLE_RATE = 44_100;
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'sfx');

function envelope(t, duration, attack = 0.008, release = 0.06) {
  if (t < attack) return t / attack;
  const remaining = duration - t;
  if (remaining < release) return Math.max(0, remaining / release);
  return 1;
}

function tone(freq, start, duration, gain = 0.5, shape = 'sine') {
  const samples = Math.round(duration * SAMPLE_RATE);
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i += 1) {
    const t = i / SAMPLE_RATE;
    const phase = 2 * Math.PI * freq * t;
    const wave =
      shape === 'triangle'
        ? (2 / Math.PI) * Math.asin(Math.sin(phase))
        : Math.sin(phase);
    out[i] = wave * gain * envelope(t, duration);
  }
  return { start, samples: out };
}

function glide(from, to, duration, gain = 0.4) {
  const samples = Math.round(duration * SAMPLE_RATE);
  const out = new Float32Array(samples);
  let phase = 0;
  for (let i = 0; i < samples; i += 1) {
    const t = i / SAMPLE_RATE;
    const freq = from + (to - from) * (t / duration);
    phase += (2 * Math.PI * freq) / SAMPLE_RATE;
    out[i] = Math.sin(phase) * gain * envelope(t, duration, 0.004, 0.04);
  }
  return { start: 0, samples: out };
}

function mix(parts, totalSeconds) {
  const total = Math.round(totalSeconds * SAMPLE_RATE);
  const buffer = new Float32Array(total);
  for (const part of parts) {
    const offset = Math.round(part.start * SAMPLE_RATE);
    for (let i = 0; i < part.samples.length && offset + i < total; i += 1) {
      buffer[offset + i] += part.samples[i];
    }
  }
  // Soft clip instead of hard clipping if two tones overlap.
  for (let i = 0; i < buffer.length; i += 1) {
    buffer[i] = Math.tanh(buffer[i]);
  }
  return buffer;
}

function writeWav(name, buffer) {
  const dataSize = buffer.length * 2;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  const pcm = Buffer.alloc(dataSize);
  for (let i = 0; i < buffer.length; i += 1) {
    const value = Math.max(-1, Math.min(1, buffer[i]));
    pcm.writeInt16LE(Math.round(value * 32_767), i * 2);
  }
  writeFileSync(join(OUT_DIR, name), Buffer.concat([header, pcm]));
}

const SOUNDS = {
  'correct.wav': mix(
    [tone(659.25, 0, 0.1, 0.32), tone(880, 0.075, 0.16, 0.3)],
    0.26,
  ),
  'wrong.wav': mix([glide(300, 190, 0.2, 0.28)], 0.22),
  'coin.wav': mix(
    [tone(1046.5, 0, 0.08, 0.24), tone(1318.5, 0.06, 0.14, 0.22)],
    0.22,
  ),
  'lesson.wav': mix(
    [tone(523.25, 0, 0.14, 0.24), tone(659.25, 0.1, 0.14, 0.24), tone(783.99, 0.2, 0.24, 0.25)],
    0.46,
  ),
  'streak.wav': mix(
    [
      tone(659.25, 0, 0.12, 0.22),
      tone(880, 0.1, 0.12, 0.22),
      tone(1108.73, 0.2, 0.24, 0.22),
    ],
    0.48,
  ),
  'hit.wav': mix([glide(880, 320, 0.075, 0.26)], 0.085),
};

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, buffer] of Object.entries(SOUNDS)) {
  writeWav(name, buffer);
  console.log(`wrote assets/sfx/${name}`);
}

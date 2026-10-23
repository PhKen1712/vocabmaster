/**
 * Generate the app's background music.
 *
 * Why generate instead of shipping downloaded tracks: every loop here is
 * original and synthesised from oscillators, so there is no licence to track,
 * no attribution screen, no third-party CDN that can disappear, and no
 * "this song was removed" surprise. The output is deterministic: the same
 * script and seed always produce the same MP3.
 *
 * Usage: node scripts/generate-music.mjs
 * Output: assets/music/<id>.mp3 (mono, 44.1 kHz, 96 kbps — ~0.6 MB per track)
 *
 * The music itself is deliberately simple: chord pad, bass, arpeggio, a little
 * percussion and a soft delay. It sits under reading and typing, so nothing is
 * allowed to poke through at high volume.
 */

import { Mp3Encoder } from '@breezystack/lamejs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 44_100;
const TAU = Math.PI * 2;
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(ROOT, '..', 'assets', 'music');

const midi = (note) => 440 * 2 ** ((note - 69) / 12);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buffer(seconds) {
  return new Float32Array(Math.ceil(seconds * SR));
}

function add(buf, startSample, value) {
  const index = startSample;
  if (index >= 0 && index < buf.length) buf[index] += value;
}

/** Soft attack, exponential decay, click-free tail. */
function pluck(buf, startSec, duration, freq, gain, timbre = 'sine') {
  const start = Math.round(startSec * SR);
  const total = Math.round(duration * SR);
  const attack = Math.min(0.008, duration * 0.1);
  const fade = Math.min(0.03, duration * 0.25);
  for (let i = 0; i < total; i += 1) {
    const t = i / SR;
    const env =
      (t < attack ? t / attack : 1) *
      Math.exp(-t / (duration * 0.42)) *
      (t > duration - fade ? Math.max(0, (duration - t) / fade) : 1);
    const phase = TAU * freq * t;
    let v;
    if (timbre === 'ep') {
      v = Math.sin(phase) + 0.38 * Math.sin(phase * 2) * Math.exp(-t * 2.2) +
        0.16 * Math.sin(phase * 3) * Math.exp(-t * 3.4);
    } else if (timbre === 'tri') {
      v = (2 / Math.PI) * Math.asin(Math.sin(phase));
    } else if (timbre === 'square') {
      v = Math.sign(Math.sin(phase)) * 0.6 + 0.4 * Math.sin(phase);
    } else {
      v = Math.sin(phase) + 0.18 * Math.sin(phase * 2);
    }
    add(buf, start + i, v * env * gain);
  }
}

/** Warm detuned pad, low-passed so it never competes with the melody. */
function pad(buf, startSec, duration, notes, gain, random) {
  const start = Math.round(startSec * SR);
  const total = Math.round(duration * SR);
  const local = new Float32Array(total);
  const attack = Math.min(0.9, duration * 0.35);
  const release = Math.min(0.8, duration * 0.3);

  for (const note of notes) {
    const freq = midi(note);
    for (const detune of [-0.06, 0.06]) {
      const f = freq * (1 + detune / 12);
      const drift = (random() - 0.5) * 0.15;
      for (let i = 0; i < total; i += 1) {
        const t = i / SR;
        const env =
          Math.min(1, t / attack) *
          Math.min(1, Math.max(0, (duration - t) / release));
        const phase = TAU * f * t + drift;
        local[i] +=
          (Math.sin(phase) * 0.6 + Math.sin(phase * 2) * 0.22 + Math.sin(phase * 3) * 0.1) *
          env *
          gain *
          0.5;
      }
    }
  }

  // One-pole low-pass keeps the pad soft without a filter library.
  let state = 0;
  const alpha = 0.16;
  for (let i = 0; i < total; i += 1) {
    state += alpha * (local[i] - state);
    add(buf, start + i, state);
  }
}

function bass(buf, startSec, duration, freq, gain) {
  const start = Math.round(startSec * SR);
  const total = Math.round(duration * SR);
  for (let i = 0; i < total; i += 1) {
    const t = i / SR;
    const env = Math.min(1, t / 0.01) * Math.exp(-t / (duration * 0.6));
    const phase = TAU * freq * t;
    add(buf, start + i, (Math.sin(phase) + 0.12 * Math.sin(phase * 2)) * env * gain);
  }
}

function kick(buf, startSec, gain, random) {
  const start = Math.round(startSec * SR);
  const total = Math.round(0.24 * SR);
  let phase = 0;
  for (let i = 0; i < total; i += 1) {
    const t = i / SR;
    const freq = 130 * Math.exp(-t * 22) + 46;
    phase += (TAU * freq) / SR;
    const env = Math.exp(-t * 16);
    add(buf, start + i, Math.sin(phase) * env * gain);
  }
  // A tiny click makes the kick readable on a phone speaker.
  for (let i = 0; i < 90; i += 1) {
    add(buf, start + i, (random() * 2 - 1) * 0.12 * gain);
  }
}

function hat(buf, startSec, gain, random, length = 0.045) {
  const start = Math.round(startSec * SR);
  const total = Math.round(length * SR);
  let previous = 0;
  for (let i = 0; i < total; i += 1) {
    const t = i / SR;
    const noise = random() * 2 - 1;
    const high = noise - previous;
    previous = noise;
    add(buf, start + i, high * Math.exp(-t / (length * 0.35)) * gain);
  }
}

function vinyl(buf, gain, random) {
  let state = 0;
  for (let i = 0; i < buf.length; i += 1) {
    state += 0.02 * ((random() * 2 - 1) - state);
    buf[i] += state * gain;
    if (random() < 0.000018) {
      const start = i;
      for (let j = 0; j < 220; j += 1) {
        add(buf, start + j, (random() * 2 - 1) * 0.2 * Math.exp(-j / 60));
      }
    }
  }
}

function delay(buf, delaySec, feedback, mix) {
  const d = Math.round(delaySec * SR);
  const copy = new Float32Array(buf.length);
  for (let i = d; i < buf.length; i += 1) {
    copy[i] = buf[i - d] + copy[i - d] * feedback;
  }
  for (let i = 0; i < buf.length; i += 1) buf[i] += copy[i] * mix;
}

/** Fold the tail back into the start so looping has no seam. */
function foldTail(buf, loopSamples) {
  const out = new Float32Array(loopSamples);
  for (let i = 0; i < loopSamples; i += 1) out[i] = buf[i] ?? 0;
  for (let i = loopSamples; i < buf.length; i += 1) out[i - loopSamples] += buf[i] * 0.8;
  return out;
}

function normalize(buf, peak = 0.89) {
  let max = 0;
  for (let i = 0; i < buf.length; i += 1) max = Math.max(max, Math.abs(buf[i]));
  if (max === 0) return;
  const scale = peak / max;
  for (let i = 0; i < buf.length; i += 1) buf[i] = Math.tanh(buf[i] * scale * 1.05) / Math.tanh(1.05);
  // 5 ms fade at both ends removes the DC step at the loop point.
  const fade = Math.round(0.005 * SR);
  for (let i = 0; i < fade; i += 1) {
    const k = i / fade;
    buf[i] *= k;
    buf[buf.length - 1 - i] *= k;
  }
}

function encodeMp3(samples, file) {
  const encoder = new Mp3Encoder(1, SR, 96);
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = Math.round(v * 32767);
  }
  const parts = [];
  for (let i = 0; i < pcm.length; i += 1152) {
    const chunk = encoder.encodeBuffer(pcm.subarray(i, Math.min(i + 1152, pcm.length)));
    if (chunk.length > 0) parts.push(Buffer.from(chunk));
  }
  const tail = encoder.flush();
  if (tail.length > 0) parts.push(Buffer.from(tail));
  fs.writeFileSync(file, Buffer.concat(parts));
}

const CHORDS = {
  Am: [57, 60, 64],
  F: [53, 57, 60],
  C: [48, 52, 55],
  G: [55, 59, 62],
  Fmaj7: [53, 57, 60, 64],
  Dm7: [50, 53, 57, 60],
  Bbmaj7: [46, 50, 53, 57],
  C7: [48, 52, 55, 58],
  D: [50, 54, 57],
  Bm: [47, 50, 54],
  Gmaj: [43, 47, 50],
  A: [45, 49, 52],
  Dm: [50, 53, 57],
  Bb: [46, 50, 53],
};

const TRACKS = [
  {
    id: 'focus-forest',
    bpm: 76,
    bars: 16,
    seed: 11,
    style: 'calm',
    progression: ['Am', 'F', 'C', 'G'],
  },
  {
    id: 'lofi-night',
    bpm: 70,
    bars: 16,
    seed: 23,
    style: 'lofi',
    progression: ['Fmaj7', 'Dm7', 'Bbmaj7', 'C7'],
  },
  {
    id: 'pixel-run',
    bpm: 122,
    bars: 16,
    seed: 37,
    style: 'chiptune',
    progression: ['C', 'G', 'Am', 'F'],
  },
  {
    id: 'sunrise',
    bpm: 88,
    bars: 16,
    seed: 51,
    style: 'bright',
    progression: ['D', 'Bm', 'Gmaj', 'A'],
  },
  {
    id: 'deep-space',
    bpm: 60,
    bars: 12,
    seed: 67,
    style: 'ambient',
    progression: ['Dm', 'Bb', 'F', 'C'],
  },
];

function renderTrack(definition) {
  const random = mulberry32(definition.seed);
  const beat = 60 / definition.bpm;
  const bar = beat * 4;
  const loopSeconds = definition.bars * bar;
  const tailSeconds = 2.2;
  const buf = buffer(loopSeconds + tailSeconds);
  const chords = definition.progression.map((name) => CHORDS[name]);

  for (let barIndex = 0; barIndex < definition.bars; barIndex += 1) {
    const start = barIndex * bar;
    const chord = chords[barIndex % chords.length];
    const root = chord[0];

    if (definition.style === 'ambient') {
      pad(buf, start, bar * 1.05, chord, 0.16, random);
      if (barIndex % 2 === 0) {
        pluck(buf, start + beat * 2, beat * 3, midi(chord[2] + 12), 0.1, 'sine');
      }
      if (barIndex % 4 === 1) {
        pluck(buf, start + beat * 3, beat * 2.4, midi(chord[1] + 24), 0.07, 'tri');
      }
      bass(buf, start, bar, midi(root - 12), 0.1);
      continue;
    }

    pad(buf, start, bar * 1.02, chord, definition.style === 'chiptune' ? 0.05 : 0.1, random);
    bass(buf, start, beat * 1.7, midi(root - 12), definition.style === 'chiptune' ? 0.15 : 0.13);
    bass(buf, start + beat * 2, beat * 1.4, midi(root - 12), 0.11);

    const subdivisions = definition.style === 'chiptune' ? 8 : 4;
    const step = bar / subdivisions;
    for (let s = 0; s < subdivisions; s += 1) {
      const noteIndex = s % chord.length;
      const octave = s % 4 === 3 ? 12 : 0;
      if (definition.style === 'lofi' && s % 2 === 1) continue;
      const gain = definition.style === 'calm' ? 0.05 : definition.style === 'chiptune' ? 0.055 : 0.045;
      pluck(
        buf,
        start + s * step,
        step * (definition.style === 'chiptune' ? 0.75 : 1.6),
        midi(chord[noteIndex] + octave + (s % 2 === 0 ? 12 : 0)),
        gain,
        definition.style === 'chiptune' ? 'square' : definition.style === 'lofi' ? 'ep' : 'sine',
      );
    }

    // A short melody every other bar, always from the chord, never busy.
    if (barIndex % 2 === 1) {
      const melodySteps = definition.style === 'chiptune' ? [0, 2, 4, 6] : [0, 2, 3];
      melodySteps.forEach((s, index) => {
        const note = chord[(index + 1) % chord.length] + 24;
        pluck(
          buf,
          start + s * step,
          beat * (definition.style === 'chiptune' ? 0.7 : 1.5),
          midi(note),
          definition.style === 'chiptune' ? 0.06 : 0.05,
          definition.style === 'lofi' ? 'ep' : 'tri',
        );
      });
    }

    if (definition.style === 'chiptune') {
      kick(buf, start, 0.3, random);
      kick(buf, start + beat * 2, 0.26, random);
      for (let s = 0; s < 8; s += 1) {
        hat(buf, start + s * (bar / 8), s % 2 === 0 ? 0.06 : 0.035, random, 0.035);
      }
    } else if (definition.style === 'lofi') {
      if (barIndex % 2 === 0) kick(buf, start, 0.22, random);
      kick(buf, start + beat * 2.5, 0.16, random);
      hat(buf, start + beat * 1, 0.03, random, 0.06);
      hat(buf, start + beat * 3, 0.028, random, 0.06);
    } else if (definition.style === 'bright') {
      kick(buf, start, 0.18, random);
      kick(buf, start + beat * 2, 0.14, random);
      hat(buf, start + beat * 0.5, 0.03, random, 0.04);
      hat(buf, start + beat * 2.5, 0.03, random, 0.04);
    }
  }

  if (definition.style === 'lofi') vinyl(buf, 0.05, random);
  if (definition.style !== 'ambient') {
    delay(buf, (beat * 3) / 4, 0.26, definition.style === 'chiptune' ? 0.08 : 0.14);
  } else {
    delay(buf, beat * 1.5, 0.35, 0.2);
  }

  const loop = foldTail(buf, Math.round(loopSeconds * SR));
  normalize(loop);
  return loop;
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const definition of TRACKS) {
  const started = Date.now();
  const samples = renderTrack(definition);
  const file = path.join(OUT_DIR, `${definition.id}.mp3`);
  encodeMp3(samples, file);
  const kb = Math.round(fs.statSync(file).size / 1024);
  const seconds = (samples.length / SR).toFixed(1);
  console.log(
    `${definition.id.padEnd(13)} ${seconds}s  ${kb} KB  (${Date.now() - started} ms)`,
  );
}
console.log(`\nDone. ${TRACKS.length} loops in ${OUT_DIR}`);

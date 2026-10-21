import { SEED_WORDS } from '../seed';
import { TARGET_DISTRIBUTION, WORD_PACKS, packRowsToSeedWords, type PackRow } from '../packs';
import type { Level } from '../../types';

const POS = new Set(['noun', 'verb', 'adjective', 'adverb', 'phrase', 'idiom']);

function key(term: string, track: string): string {
  return `${term.trim().toLowerCase()}|${track}`;
}

function mentionsTerm(example: string, term: string): boolean {
  const needle = term.toLowerCase();
  const haystack = example.toLowerCase();
  if (haystack.includes(needle)) return true;
  const stem = needle.replace(/(e|y)$/, '');
  return stem.length >= 4 && haystack.includes(stem);
}

describe('word pack targets', () => {
  it('sizes each track at 2500 words', () => {
    for (const pack of WORD_PACKS) {
      const total = Object.values(TARGET_DISTRIBUTION[pack.track]).reduce((a, b) => a + b, 0);
      expect(total).toBe(2500);
      expect(pack.targetSize).toBe(2500);
    }
  });

  it('puts fewer words at every higher level', () => {
    for (const pack of WORD_PACKS) {
      const levels = Object.keys(TARGET_DISTRIBUTION[pack.track])
        .map(Number)
        .sort((a, b) => a - b);
      // IELTS has no Starter/A1 band, so zeros are skipped rather than compared.
      const counts = levels
        .map((level) => TARGET_DISTRIBUTION[pack.track][level as Level])
        .filter((count) => count > 0);
      expect(counts.length).toBeGreaterThan(2);
      for (let index = 1; index < counts.length; index += 1) {
        expect(counts[index]).toBeLessThan(counts[index - 1] as number);
      }
    }
  });
});

describe('word pack content', () => {
  const allRows = WORD_PACKS.flatMap((pack) =>
    pack.rows.map((row) => ({ pack, row, term: row[0] })),
  );

  it('has content in both tracks', () => {
    expect(WORD_PACKS.map((pack) => pack.track).sort()).toEqual(['general', 'ielts']);
    for (const pack of WORD_PACKS) expect(pack.rows.length).toBeGreaterThan(20);
  });

  it('never exceeds the target size of its pack', () => {
    for (const pack of WORD_PACKS) {
      expect(pack.rows.length).toBeLessThanOrEqual(pack.targetSize);
    }
  });

  it('fills every required field with something usable', () => {
    for (const { row, term } of allRows) {
      const [, meaningVi, partOfSpeech, level, topic, definitionEn, exampleEn] = row as PackRow;
      expect(term.trim().length).toBeGreaterThan(1);
      expect(meaningVi.trim().length).toBeGreaterThan(0);
      expect(meaningVi.trim().toLowerCase()).not.toBe(term.trim().toLowerCase());
      expect(POS.has(partOfSpeech)).toBe(true);
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThanOrEqual(6);
      expect(topic.trim().length).toBeGreaterThan(0);
      expect((definitionEn ?? '').trim().length).toBeGreaterThan(5);
      expect((exampleEn ?? '').trim().length).toBeGreaterThan(5);
    }
  });

  it('uses the level bands the track is designed to cover', () => {
    for (const { pack, row } of allRows) {
      const level = row[3];
      expect(TARGET_DISTRIBUTION[pack.track][level]).toBeGreaterThan(0);
    }
  });

  it('uses an example sentence that actually contains the word', () => {
    for (const { row, term } of allRows) {
      expect(mentionsTerm(row[6] ?? '', term)).toBe(true);
    }
  });

  it('has no duplicate word inside a track', () => {
    const seen = new Set<string>();
    for (const { pack, term } of allRows) {
      const id = key(term, pack.track);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });

  it('does not duplicate the hand-written starter list', () => {
    const seeds = new Set(SEED_WORDS.map((word) => key(word.term, word.track)));
    for (const { pack, term } of allRows) {
      expect(seeds.has(key(term, pack.track))).toBe(false);
    }
  });
});

describe('packRowsToSeedWords', () => {
  it('flattens every row and keeps the track of its pack', () => {
    const words = packRowsToSeedWords();
    const total = WORD_PACKS.reduce((sum, pack) => sum + pack.rows.length, 0);
    expect(words).toHaveLength(total);

    for (const pack of WORD_PACKS) {
      const fromPack = words.filter((word) => word.track === pack.track);
      expect(fromPack).toHaveLength(pack.rows.length);
    }
  });

  it('carries the optional fields through when present', () => {
    const [first] = packRowsToSeedWords();
    expect(first?.definitionEn).toBeTruthy();
    expect(first?.exampleEn).toBeTruthy();
    expect(first?.level).toBeGreaterThanOrEqual(0);
  });
});

import {
  ASTEROID_MAX_ON_SCREEN,
  ASTEROID_SPAWN_MS,
  blankTerm,
  createAsteroidGame,
  spawnAsteroid,
  startAsteroidGame,
} from '../asteroid';

function seeded(seed = 7): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

describe('blanked asteroid words', () => {
  it('keeps the first letter of every word and all spaces visible', () => {
    const { masked, blanked } = blankTerm('take into account', 3, seeded(2));
    expect(masked).toHaveLength('take into account'.length);
    expect(masked[0]).toBe('t');
    expect(masked[5]).toBe('i');
    expect(masked[10]).toBe('a');
    expect(masked[4]).toBe(' ');
    expect(masked[9]).toBe(' ');
    expect(blanked.length).toBeGreaterThan(0);
  });

  it('never hides a whole short word', () => {
    const { masked } = blankTerm('cat', 6, seeded(1));
    expect(masked.startsWith('c')).toBe(true);
    expect(masked).not.toBe('___');
  });

  it('shows a very short word without blanks', () => {
    expect(blankTerm('ox', 6, seeded(1)).masked).toBe('ox');
  });

  it('hides more letters as the level rises', () => {
    const easy = blankTerm('environment', 0, seeded(9)).blanked.length;
    const hard = blankTerm('environment', 6, seeded(9)).blanked.length;
    expect(hard).toBeGreaterThanOrEqual(easy);
    expect(hard).toBeLessThanOrEqual(8);
  });

  it('stores the masked form on the spawned asteroid', () => {
    const game = spawnAsteroid(
      startAsteroidGame(createAsteroidGame()),
      [{ term: 'criminal', meaningVi: 'tội phạm', level: 3 }],
      seeded(4),
    );
    expect(game.asteroids).toHaveLength(1);
    expect(game.asteroids[0]?.maskedTerm).toMatch(/^c/);
    expect(game.asteroids[0]?.blanked.length).toBeGreaterThan(0);
  });
});

describe('calmer spawn settings', () => {
  it('leaves a longer pause and fewer simultaneous cards', () => {
    expect(ASTEROID_SPAWN_MS).toBeGreaterThanOrEqual(3_000);
    expect(ASTEROID_MAX_ON_SCREEN).toBeLessThanOrEqual(4);
  });
});

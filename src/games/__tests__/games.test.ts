import {
  ASTEROID_LIVES,
  ASTEROID_MAX_ON_SCREEN,
  asteroidSpeed,
  createAsteroidGame,
  spawnAsteroid,
  startAsteroidGame,
  tickAsteroid,
  typeAsteroid,
} from '../asteroid';
import { answerRush, continueRush, createRush, startRush, tickRush } from '../rush';
import {
  createMemory,
  flipMemory,
  memoryAccuracy,
  resolveMemory,
} from '../memory';

const WORDS = [
  { term: 'cat', meaningVi: 'con mèo' },
  { term: 'care', meaningVi: 'quan tâm' },
  { term: 'brave', meaningVi: 'dũng cảm' },
  { term: 'borrow', meaningVi: 'mượn' },
  { term: 'lane', meaningVi: 'làn đường' },
  { term: 'harvest', meaningVi: 'thu hoạch' },
  { term: 'modest', meaningVi: 'khiêm tốn' },
  { term: 'thrive', meaningVi: 'phát triển mạnh' },
];

function seeded(seed = 7): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

describe('asteroid game', () => {
  it('starts in the ready state with three lives and no words on screen', () => {
    const game = createAsteroidGame();
    expect(game.status).toBe('ready');
    expect(game.lives).toBe(ASTEROID_LIVES);
    expect(game.asteroids).toHaveLength(0);
  });

  it('spawns a word from the pool above the play area', () => {
    const rng = seeded();
    const game = spawnAsteroid(startAsteroidGame(createAsteroidGame()), WORDS, rng);
    expect(game.asteroids).toHaveLength(1);
    const asteroid = game.asteroids[0]!;
    expect(WORDS.map((word) => word.term)).toContain(asteroid.term);
    expect(asteroid.meaning).toBe(WORDS.find((word) => word.term === asteroid.term)?.meaningVi);
    expect(asteroid.y).toBeLessThan(0);
    expect(asteroid.x).toBeGreaterThanOrEqual(0);
    expect(asteroid.x).toBeLessThanOrEqual(1);
  });

  it('does not repeat a word that is already falling', () => {
    const rng = seeded(11);
    let game = startAsteroidGame(createAsteroidGame());
    for (let i = 0; i < 4; i += 1) {
      game = tickAsteroid(game, 3_000, WORDS, rng);
    }
    const terms = game.asteroids.map((asteroid) => asteroid.term);
    expect(new Set(terms).size).toBe(terms.length);
  });

  it('never puts more than the cap of words on screen', () => {
    const rng = seeded(3);
    let game = startAsteroidGame(createAsteroidGame());
    for (let i = 0; i < 20; i += 1) {
      game = tickAsteroid(game, 2_000, WORDS, rng);
    }
    expect(game.asteroids.length).toBeLessThanOrEqual(ASTEROID_MAX_ON_SCREEN);
  });

  it('highlights a prefix, then destroys the word on an exact match', () => {
    const rng = seeded(5);
    let game = spawnAsteroid(startAsteroidGame(createAsteroidGame()), WORDS, rng);
    const target = game.asteroids[0]!;

    let result = typeAsteroid(game, target.term.slice(0, 2));
    expect(result.destroyed).toBeNull();
    expect(result.wrong).toBe(false);
    expect(result.state.typed).toBe(target.term.slice(0, 2));

    result = typeAsteroid(result.state, target.term.toUpperCase());
    expect(result.destroyed?.id).toBe(target.id);
    expect(result.state.asteroids).toHaveLength(0);
    expect(result.state.typed).toBe('');
    expect(result.state.score).toBe(10);
    expect(result.state.combo).toBe(1);
    expect(result.state.hits).toBe(1);
  });

  it('breaks the combo and clears the input on a word that matches nothing', () => {
    const rng = seeded(5);
    const game = spawnAsteroid(startAsteroidGame(createAsteroidGame()), WORDS, rng);
    const result = typeAsteroid(game, 'zzz');
    expect(result.wrong).toBe(true);
    expect(result.state.typed).toBe('');
    expect(result.state.combo).toBe(0);
    expect(result.state.asteroids).toHaveLength(1);
  });

  it('rewards consecutive kills with a bigger score', () => {
    const rng = seeded(9);
    let game = startAsteroidGame(createAsteroidGame());
    game = { ...game, nextSpawnMs: 0 };
    game = tickAsteroid(game, 10, WORDS, rng);
    const first = game.asteroids[0]!;
    game = typeAsteroid(game, first.term).state;
    game = { ...game, nextSpawnMs: 0 };
    game = tickAsteroid(game, 10, WORDS, rng);
    const second = game.asteroids[0]!;
    game = typeAsteroid(game, second.term).state;
    expect(game.combo).toBe(2);
    expect(game.score).toBe(25);
    expect(game.bestCombo).toBe(2);
  });

  it('loses a life when a word reaches the bottom and ends after three misses', () => {
    const rng = seeded(4);
    let game = spawnAsteroid(startAsteroidGame(createAsteroidGame()), WORDS, rng);
    game = { ...game, asteroids: game.asteroids.map((asteroid) => ({ ...asteroid, y: 0.99 })) };
    game = tickAsteroid(game, 1_000, WORDS, rng);
    expect(game.lives).toBe(2);
    expect(game.missed).toBe(1);
    expect(game.status).toBe('playing');

    for (let i = 0; i < 2; i += 1) {
      game = spawnAsteroid({ ...game, nextSpawnMs: 0 }, WORDS, rng);
      game = {
        ...game,
        asteroids: game.asteroids.map((asteroid) => ({ ...asteroid, y: 0.995 })),
      };
      game = tickAsteroid(game, 1_000, WORDS, rng);
    }
    expect(game.lives).toBe(0);
    expect(game.status).toBe('over');
  });

  it('spawns on the scheduled beat and speeds up over time', () => {
    const game = startAsteroidGame(createAsteroidGame());
    const spawned = tickAsteroid(game, 700, WORDS, seeded(2));
    expect(spawned.asteroids).toHaveLength(1);
    expect(asteroidSpeed(0)).toBeCloseTo(0.04);
    expect(asteroidSpeed(60_000)).toBeGreaterThan(asteroidSpeed(0));
    expect(asteroidSpeed(600_000)).toBeLessThanOrEqual(0.09);
  });

  it('starts a fresh run', () => {
    const rng = seeded(6);
    let game = spawnAsteroid(startAsteroidGame(createAsteroidGame()), WORDS, rng);
    game = typeAsteroid(game, 'cat').state;
    const fresh = startAsteroidGame(game);
    expect(fresh.score).toBe(0);
    expect(fresh.lives).toBe(ASTEROID_LIVES);
    expect(fresh.asteroids).toHaveLength(0);
    expect(fresh.status).toBe('playing');
  });
});

describe('rush quiz', () => {
  it('builds four-option questions with the correct answer present', () => {
    const state = createRush(WORDS, seeded(1));
    expect(state.questions.length).toBeGreaterThan(0);
    for (const question of state.questions) {
      expect(question.options).toHaveLength(4);
      expect(new Set(question.options).size).toBe(4);
      expect(question.options[question.answerIndex]).toBeDefined();
    }
  });

  it('refuses to build a game with fewer than four distinct meanings', () => {
    const state = createRush(WORDS.slice(0, 3), seeded(1));
    expect(state.status).toBe('over');
    expect(state.questions).toHaveLength(0);
  });

  it('counts down and ends at zero', () => {
    const started = startRush(createRush(WORDS, seeded(2), 5_000));
    const after = tickRush(started, 5_000);
    expect(after.timeLeftMs).toBe(0);
    expect(after.status).toBe('over');
  });

  it('scores correct answers, grows the combo and adds time', () => {
    const started = startRush(createRush(WORDS, seeded(3)));
    const question = started.questions[0]!;
    const cooled = tickRush(started, 10_000);
    const after = answerRush(cooled, question.answerIndex);
    expect(after.score).toBe(10);
    expect(after.combo).toBe(1);
    expect(after.correct).toBe(1);
    expect(after.feedback?.correct).toBe(true);
    expect(after.timeLeftMs).toBeGreaterThan(cooled.timeLeftMs);
    expect(after.index).toBe(1);
  });

  it('breaks the combo and costs time on a wrong answer without ending the run', () => {
    const started = startRush(createRush(WORDS, seeded(3)));
    const question = started.questions[0]!;
    const wrongChoice = question.answerIndex === 0 ? 1 : 0;
    const after = answerRush(started, wrongChoice);
    expect(after.score).toBe(0);
    expect(after.combo).toBe(0);
    expect(after.wrong).toBe(1);
    expect(after.timeLeftMs).toBeLessThan(started.timeLeftMs);
    expect(after.status).toBe('playing');
  });

  it('ends when the last question is answered and no refill is offered', () => {
    let state = startRush(createRush(WORDS, seeded(4)));
    let guard = 0;
    while (state.status === 'playing' && guard < 100) {
      const question = state.questions[state.index]!;
      state = answerRush(state, question.answerIndex);
      guard += 1;
    }
    expect(state.status).toBe('over');
    expect(state.correct).toBe(state.questions.length);
    expect(state.score).toBeGreaterThan(0);
  });

  it('refills the batch so a small collection still plays the whole minute', () => {
    // Four words produce four questions; without a refill the mode ended after
    // a few seconds and looked broken.
    let state = startRush(createRush(WORDS.slice(0, 4), seeded(5)));
    const before = state.questions.length;
    for (let i = 0; i < before; i += 1) {
      state = answerRush(state, state.questions[state.index]!.answerIndex);
    }
    expect(state.status).toBe('over');
    expect(state.timeLeftMs).toBeGreaterThan(0);

    const continued = continueRush(state, WORDS.slice(0, 4), seeded(6));
    expect(continued.status).toBe('playing');
    expect(continued.questions.length).toBe(before * 2);
    expect(continued.index).toBe(before);
    expect(continued.score).toBe(state.score);
    expect(continued.correct).toBe(before);
    expect(continued.timeLeftMs).toBe(state.timeLeftMs);
  });

  it('does not refill after the clock reaches zero', () => {
    const started = startRush(createRush(WORDS, seeded(7), 1_000));
    const ended = tickRush(started, 1_000);
    const continued = continueRush(ended, WORDS, seeded(8));
    expect(continued).toBe(ended);
  });
});

describe('memory match', () => {
  it('deals two cards per pair, shuffled', () => {
    const state = createMemory(WORDS, 4, seeded(8));
    expect(state.cards).toHaveLength(8);
    expect(state.totalPairs).toBe(4);
    expect(state.status).toBe('playing');
    expect(state.cards.filter((card) => card.kind === 'term')).toHaveLength(4);
    expect(state.cards.filter((card) => card.kind === 'meaning')).toHaveLength(4);
  });

  it('keeps a mismatched pair open until it is resolved', () => {
    const state = createMemory(WORDS, 3, seeded(1));
    const first = state.cards[0]!;
    const second = state.cards.find(
      (card) => card.pairId !== first.pairId && !card.matched,
    )!;

    const opened = flipMemory(state, first.id);
    expect(opened.open).toEqual([first.id]);

    const mismatched = flipMemory(opened, second.id);
    expect(mismatched.open).toHaveLength(2);
    expect(mismatched.wrongPair).not.toBeNull();
    expect(mismatched.matchedPairs).toBe(0);

    // Clicking while a mismatch is showing does nothing.
    expect(flipMemory(mismatched, state.cards[2]!.id)).toBe(mismatched);

    const resolved = resolveMemory(mismatched);
    expect(resolved.open).toHaveLength(0);
    expect(resolved.wrongPair).toBeNull();
  });

  it('completes a match and finishes the board', () => {
    const state = createMemory(WORDS, 2, seeded(6));
    const term = state.cards.find((card) => card.kind === 'term')!;
    const meaning = state.cards.find(
      (card) => card.pairId === term.pairId && card.kind === 'meaning',
    )!;

    const matched = flipMemory(flipMemory(state, term.id), meaning.id);
    expect(matched.matchedPairs).toBe(1);
    expect(matched.open).toHaveLength(0);
    expect(matched.cards.filter((card) => card.pairId === term.pairId).every((card) => card.matched)).toBe(true);

    const otherTerm = matched.cards.find((card) => card.kind === 'term' && !card.matched)!;
    const otherMeaning = matched.cards.find(
      (card) => card.pairId === otherTerm.pairId && card.kind === 'meaning',
    )!;
    const done = flipMemory(flipMemory(matched, otherTerm.id), otherMeaning.id);
    expect(done.status).toBe('over');
    expect(memoryAccuracy(done)).toBe(50);
  });

  it('ignores a second tap on an open card or a matched card', () => {
    const state = createMemory(WORDS, 3, seeded(2));
    const first = state.cards[0]!;
    const opened = flipMemory(state, first.id);
    expect(flipMemory(opened, first.id).flips).toBe(1);

    const term = state.cards.find((card) => card.kind === 'term')!;
    const meaning = state.cards.find(
      (card) => card.pairId === term.pairId && card.kind === 'meaning',
    )!;
    const matched = flipMemory(flipMemory(state, term.id), meaning.id);
    expect(flipMemory(matched, term.id)).toBe(matched);
  });
});

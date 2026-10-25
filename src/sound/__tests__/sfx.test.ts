// The gate is pure; the native player only needs to exist for the module import.
jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(() => ({
    volume: 1,
    seekTo: jest.fn(() => Promise.resolve()),
    play: jest.fn(),
    remove: jest.fn(),
  })),
}));

import { shouldPlaySfx, type SfxGate } from '../sfx';

function gate(overrides: Partial<SfxGate> = {}): SfxGate {
  return {
    enabled: true,
    volume: 0.55,
    lastPlayedAt: 0,
    lastKind: null,
    ...overrides,
  };
}

describe('shouldPlaySfx', () => {
  it('never plays while effects are disabled', () => {
    expect(shouldPlaySfx('correct', 10_000, gate({ enabled: false }))).toBe(false);
  });

  it('never plays at zero volume', () => {
    expect(shouldPlaySfx('correct', 10_000, gate({ volume: 0 }))).toBe(false);
  });

  it('allows the first effect', () => {
    expect(shouldPlaySfx('correct', 10_000, gate())).toBe(true);
  });

  it('blocks any second effect within 70 ms so sounds cannot pile up', () => {
    expect(shouldPlaySfx('wrong', 10_050, gate({ lastPlayedAt: 10_000, lastKind: 'correct' }))).toBe(
      false,
    );
    expect(shouldPlaySfx('wrong', 10_071, gate({ lastPlayedAt: 10_000, lastKind: 'correct' }))).toBe(
      true,
    );
  });

  it('blocks the same effect for 120 ms', () => {
    expect(shouldPlaySfx('coin', 10_100, gate({ lastPlayedAt: 10_000, lastKind: 'coin' }))).toBe(
      false,
    );
    expect(shouldPlaySfx('coin', 10_121, gate({ lastPlayedAt: 10_000, lastKind: 'coin' }))).toBe(
      true,
    );
  });

  it('uses a shorter gap for a meteor hit than for other effects', () => {
    const afterCoin = gate({ lastPlayedAt: 10_000, lastKind: 'coin' });
    expect(shouldPlaySfx('hit', 10_050, afterCoin)).toBe(true);
    expect(shouldPlaySfx('correct', 10_050, afterCoin)).toBe(false);
  });
});

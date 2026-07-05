import { describe, it, expect, beforeEach } from 'vitest';
import { ACHIEVEMENTS, evaluate, loadUnlocked } from '../src/achievements.js';

// Minimal in-memory localStorage so the module's persistence path is exercised
// in the node test environment (there is no DOM here).
beforeEach(() => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
});

const zeroStats = {
  games: 0, totalScore: 0, bestScore: 0, bestStreak: 0,
  dailiesPlayed: 0, dailyStreak: 0, lastDailyDay: null,
};
const ctx = (stats = {}, run = {}) => ({
  stats: { ...zeroStats, ...stats },
  run: { score: 0, bestStreak: 0, won: false, mode: 'classic', variant: false, ...run },
});

describe('achievements', () => {
  it('all ids are unique', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('unlocks the first-game achievement on the very first run', () => {
    const newly = evaluate(ctx({ games: 1 }));
    expect(newly.map((a) => a.id)).toContain('first-bite');
  });

  it('does not re-award an already-unlocked achievement', () => {
    evaluate(ctx({ games: 1 }));
    const again = evaluate(ctx({ games: 1 }));
    expect(again.map((a) => a.id)).not.toContain('first-bite');
    expect(loadUnlocked().has('first-bite')).toBe(true);
  });

  it('gates score and streak milestones on the right thresholds', () => {
    expect(evaluate(ctx({ games: 1, bestScore: 99 })).map((a) => a.id)).not.toContain('century');
    expect(evaluate(ctx({ games: 1, bestScore: 100 })).map((a) => a.id)).toContain('century');
    // combo-chain needs a streak of 10
    expect(evaluate(ctx({ bestStreak: 10 })).map((a) => a.id)).toContain('combo-chain');
  });

  it('awards full-year only for a won graph run and rule-bender for variants', () => {
    expect(evaluate(ctx({}, { won: true, mode: 'graph' })).map((a) => a.id)).toContain('full-year');
    expect(evaluate(ctx({}, { variant: true })).map((a) => a.id)).toContain('rule-bender');
  });

  it('accumulates unlocks across runs without dropping earlier ones', () => {
    evaluate(ctx({ games: 1 }));
    evaluate(ctx({ games: 10 }));
    const ids = loadUnlocked();
    expect(ids.has('first-bite')).toBe(true);
    expect(ids.has('regular')).toBe(true);
  });
});

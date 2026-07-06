import { describe, it, expect, beforeEach } from 'vitest';
import { ACHIEVEMENTS, evaluate, loadUnlocked, reconcileUnlocked } from '../src/achievements.js';

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
    // combo-chain needs a streak of 20
    expect(evaluate(ctx({ bestStreak: 19 })).map((a) => a.id)).not.toContain('combo-chain');
    expect(evaluate(ctx({ bestStreak: 20 })).map((a) => a.id)).toContain('combo-chain');
  });

  it('gates the harder tiers on their raised thresholds', () => {
    expect(evaluate(ctx({ games: 99 })).map((a) => a.id)).not.toContain('committed');
    expect(evaluate(ctx({ games: 100 })).map((a) => a.id)).toContain('committed');
    expect(evaluate(ctx({ bestScore: 399 })).map((a) => a.id)).not.toContain('on-fire');
    expect(evaluate(ctx({ bestScore: 400 })).map((a) => a.id)).toContain('on-fire');
    expect(evaluate(ctx({ bestStreak: 49 })).map((a) => a.id)).not.toContain('unbroken');
    expect(evaluate(ctx({ bestStreak: 50 })).map((a) => a.id)).toContain('unbroken');
    expect(evaluate(ctx({ dailyStreak: 13 })).map((a) => a.id)).not.toContain('daily-devotee');
    expect(evaluate(ctx({ dailyStreak: 14 })).map((a) => a.id)).toContain('daily-devotee');
  });

  it('awards full-year only for a won graph run and rule-bender for variants', () => {
    expect(evaluate(ctx({}, { won: true, mode: 'graph' })).map((a) => a.id)).toContain('full-year');
    expect(evaluate(ctx({}, { variant: true })).map((a) => a.id)).toContain('rule-bender');
  });

  it('exposes progress toward threshold achievements', () => {
    const regular = ACHIEVEMENTS.find((a) => a.id === 'regular');
    expect(regular.progress({ ...zeroStats, games: 3 })).toEqual([3, 10]);
    const unbroken = ACHIEVEMENTS.find((a) => a.id === 'unbroken');
    expect(unbroken.progress({ ...zeroStats, bestStreak: 12 })).toEqual([12, 50]);
    // Event-based achievements have no meaningful progress.
    expect(ACHIEVEMENTS.find((a) => a.id === 'full-year').progress).toBeUndefined();
    expect(ACHIEVEMENTS.find((a) => a.id === 'gold-rush').progress).toBeUndefined();
  });

  it('accumulates unlocks across runs without dropping earlier ones', () => {
    evaluate(ctx({ games: 1 }));
    evaluate(ctx({ games: 10 }));
    const ids = loadUnlocked();
    expect(ids.has('first-bite')).toBe(true);
    expect(ids.has('regular')).toBe(true);
  });

  it('reconcile clears only the buffed achievements once, keeping the rest', () => {
    // A player who unlocked everything at the old, easier bars.
    localStorage.setItem('gh-snake-achievements', JSON.stringify(ACHIEVEMENTS.map((a) => a.id)));
    const cleared = reconcileUnlocked().sort();
    expect(cleared).toEqual(['combo-chain', 'committed', 'daily-devotee', 'on-fire', 'unbroken']);
    const set = loadUnlocked();
    for (const id of cleared) expect(set.has(id)).toBe(false);
    for (const id of ['first-bite', 'regular', 'century', 'full-year', 'rule-bender']) {
      expect(set.has(id)).toBe(true);
    }
  });

  it('reconcile runs only once — a re-earned achievement is not cleared again', () => {
    localStorage.setItem('gh-snake-achievements', JSON.stringify(['committed']));
    expect(reconcileUnlocked()).toEqual(['committed']);
    evaluate(ctx({ games: 100 })); // re-earn at the new bar
    expect(loadUnlocked().has('committed')).toBe(true);
    expect(reconcileUnlocked()).toEqual([]); // guarded: no-op
    expect(loadUnlocked().has('committed')).toBe(true);
  });
});

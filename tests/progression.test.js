import { beforeEach, describe, expect, it } from 'vitest';
import {
  campaignUnlocked, loadProgress, recordProgress, resolveLoadout, selectCosmetic,
} from '../src/progression.js';
import { CAMPAIGN_LEVELS } from '../src/game/campaign.js';

beforeEach(() => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  };
});

const stats = (overrides = {}) => ({
  games: 0,
  totalScore: 0,
  bestScore: 0,
  bestStreak: 0,
  dailiesPlayed: 0,
  dailyStreak: 0,
  lastDailyDay: null,
  ...overrides,
});

describe('progression', () => {
  it('unlocks campaign levels sequentially after a clear', () => {
    expect(campaignUnlocked(CAMPAIGN_LEVELS[0].id)).toBe(true);
    expect(campaignUnlocked(CAMPAIGN_LEVELS[1].id)).toBe(false);

    recordProgress({
      stats: stats(),
      mode: 'campaign',
      campaignId: CAMPAIGN_LEVELS[0].id,
      won: true,
    });

    expect(campaignUnlocked(CAMPAIGN_LEVELS[1].id)).toBe(true);
    expect(loadProgress().campaignCompleted).toEqual([CAMPAIGN_LEVELS[0].id]);
  });

  it('records each Daily objective once', () => {
    const first = recordProgress({
      stats: stats({ dailyStreak: 1 }),
      mode: 'daily',
      day: '2026-07-17',
      objectiveComplete: true,
    });
    const repeat = recordProgress({
      stats: stats({ dailyStreak: 1 }),
      mode: 'daily',
      day: '2026-07-17',
      objectiveComplete: true,
    });

    expect(first.dailyObjectiveCompleted).toBe(true);
    expect(repeat.dailyObjectiveCompleted).toBe(false);
    expect(loadProgress().dailyObjectives).toEqual(['2026-07-17']);
  });

  it('unlocks and equips the gold skin at a three-day Daily streak', () => {
    const result = recordProgress({
      stats: stats({ dailyStreak: 3 }),
      previousStats: stats({ dailyStreak: 2 }),
      mode: 'daily',
      day: '2026-07-17',
    });
    expect(result.unlocked.map((item) => item.id)).toContain('gold');
    expect(selectCosmetic('skin', 'gold', stats({ dailyStreak: 3 }))).toBe(true);
    expect(resolveLoadout(stats({ dailyStreak: 3 })).skin.id).toBe('gold');
  });

  it('does not equip locked cosmetics', () => {
    expect(selectCosmetic('trail', 'comet', stats())).toBe(false);
    expect(resolveLoadout(stats()).trail.id).toBe('none');
  });
});


import { describe, expect, it } from 'vitest';
import { createGame } from '../src/game/core.js';
import {
  claimDailyLocalResult, dailyChallengeNumber, dailyScorecard, dailyShareGrid,
  mergeDailyLocalResult, shareText,
} from '../src/share.js';

describe('Daily sharing', () => {
  it('uses a stable challenge number for each UTC date', () => {
    expect(dailyChallengeNumber('2026-01-01')).toBe(1);
    expect(dailyChallengeNumber('2026-01-02')).toBe(2);
  });

  it('keeps the one-shot claim when a later practice run scores higher', () => {
    const ranked = claimDailyLocalResult(null, 50, 7);
    expect(ranked).toEqual({
      score: 50, rank: 7, rankedScore: 50, claimed: true,
    });

    const practice = mergeDailyLocalResult(ranked, 200);
    expect(practice).toEqual({
      score: 200, rank: 7, rankedScore: 50, claimed: true,
    });
  });

  it('migrates legacy ranked Daily results into claimed state', () => {
    expect(mergeDailyLocalResult({ score: 80, rank: 3 }, 120)).toEqual({
      score: 120, rank: 3, rankedScore: 80, claimed: true,
    });
  });

  it('builds stable labeled rows without revealing the board', () => {
    const game = createGame({ mode: 'daily', seed: 10, day: '2026-07-17' });
    game.score = 105;
    game.bestStreak = 8;
    game.goldenEaten = 1;
    const grid = dailyShareGrid(game);
    const rows = dailyScorecard(game);
    expect(rows.map((row) => row.key)).toEqual(['score', 'streak', 'bonus', 'goal']);
    expect(grid).toContain('Score 105  🟩🟩🟩⬛⬛');
    expect(grid).toContain('Streak 8  🟩🟩🟩🟩⬛');
    expect(grid).toContain('Bonus 1  🟨⬛⬛⬛⬛');
  });

  it('includes scorecard, rank, Daily streak, cosmetic, and objective in shared text', () => {
    const day = '2026-07-17';
    const game = createGame({ mode: 'daily', seed: 10, day });
    game.score = 175;
    game.bestStreak = 7;
    const text = shareText({
      game, mode: 'daily', day, rank: 4, dailyStreak: 6, skinId: 'gold',
    });
    expect(text).toContain(`GitSnake Daily #${dailyChallengeNumber(day)}`);
    expect(text).toContain(dailyShareGrid(game));
    expect(text).toContain('Score 175');
    expect(text).toContain('Streak 7');
    expect(text).toContain('#4 today');
    expect(text).toContain('6-day streak');
    expect(text).toContain('Style: Golden Merge');
    expect(text).toContain(game.dailyBrief.objective.label);
    expect(text).toContain('Goal:');
    expect(text).toContain('Can you beat it?');
    expect(text).not.toMatch(/[🎯🔥🎨]/u);

    const archived = shareText({
      game, mode: 'daily', day, rank: 4, rankLabel: 'on this Daily',
    });
    expect(archived).toContain('#4 on this Daily');
    expect(archived).not.toContain('#4 today');
  });
});

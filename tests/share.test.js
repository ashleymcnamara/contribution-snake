import { describe, expect, it } from 'vitest';
import { createGame } from '../src/game/core.js';
import {
  dailyChallengeNumber, dailyShareGrid, shareText,
} from '../src/share.js';

describe('Daily sharing', () => {
  it('uses a stable challenge number for each UTC date', () => {
    expect(dailyChallengeNumber('2026-01-01')).toBe(1);
    expect(dailyChallengeNumber('2026-01-02')).toBe(2);
  });

  it('builds a five-tile spoiler-free result grid', () => {
    const game = createGame({ mode: 'daily', seed: 10, day: '2026-07-17' });
    game.score = 200;
    game.bestStreak = 6;
    game.goldenEaten = 1;
    const grid = dailyShareGrid(game);
    expect([...grid]).toHaveLength(5);
    expect(grid).toMatch(/^[🟩🟨⬛]+$/u);
  });

  it('includes the grid, score, streak, and objective in shared text', () => {
    const day = '2026-07-17';
    const game = createGame({ mode: 'daily', seed: 10, day });
    game.score = 175;
    game.bestStreak = 7;
    const text = shareText({ game, mode: 'daily', day, rank: 4 });
    expect(text).toContain(`GitSnake Daily #${dailyChallengeNumber(day)}`);
    expect(text).toContain(dailyShareGrid(game));
    expect(text).toContain('175 contributions');
    expect(text).toContain('#4 today');
    expect(text).toContain(game.dailyBrief.objective.label);
  });
});


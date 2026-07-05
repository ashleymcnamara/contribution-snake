import { describe, it, expect } from 'vitest';
import {
  createGame, queueInput, step, replayGame, validateInputLog,
  STREAK_WINDOW, BASE_SPEED, MIN_SPEED,
} from '../src/game/core.js';
import { playBotRun } from './helpers.js';

describe('deterministic core', () => {
  it('replays a run to an identical final state', () => {
    for (const seed of [1, 42, 777, 123456]) {
      const live = playBotRun(seed);
      expect(live.alive).toBe(false);
      const replayed = replayGame({ mode: 'classic', seed }, live.inputLog);
      expect(replayed.score).toBe(live.score);
      expect(replayed.stepCount).toBe(live.stepCount);
      expect(replayed.snake.length).toBe(live.snake.length);
      expect(replayed.bestStreak).toBe(live.bestStreak);
      expect(replayed.elapsedGameMs).toBe(live.elapsedGameMs);
    }
  });

  it('same seed produces the same food sequence', () => {
    const a = createGame({ mode: 'classic', seed: 99 });
    const b = createGame({ mode: 'classic', seed: 99 });
    expect(a.food).toEqual(b.food);
    for (let i = 0; i < 10; i++) { step(a); step(b); }
    expect(a.snake).toEqual(b.snake);
  });

  it('accumulates at least BASE_SPEED ms per step of game time', () => {
    const game = createGame({ mode: 'classic', seed: 5 });
    step(game);
    step(game);
    expect(game.elapsedGameMs).toBe(2 * BASE_SPEED);
  });

  it('rejects reversal inputs', () => {
    const game = createGame({ mode: 'classic', seed: 1 }); // moving right
    expect(queueInput(game, 3)).toBe(false); // left = reverse
    expect(queueInput(game, 0)).toBe(true);
    expect(game.inputLog).toHaveLength(1);
  });

  it('dies on wall collision', () => {
    const game = createGame({ mode: 'classic', seed: 1 });
    let ev = {};
    while (game.alive) ev = step(game); // runs right into the wall
    expect(ev.died).toBe(true);
    expect(game.alive).toBe(false);
  });
});

describe('streak window', () => {
  function gameWithFoodAt(offsetSteps) {
    // Force food placements by manipulating state directly: simpler to test
    // the streak arithmetic through stepsSinceFood.
    const game = createGame({ mode: 'classic', seed: 7 });
    game.streak = 3;
    game.multiplier = 1.5;
    game.stepsSinceFood = offsetSteps;
    // Put food directly in front of the head.
    game.food = { x: game.snake[0].x + 1, y: game.snake[0].y };
    step(game);
    return game;
  }

  it('continues the streak when eating within the window', () => {
    const game = gameWithFoodAt(STREAK_WINDOW);
    expect(game.streak).toBe(4);
  });

  it('resets the streak when eating after the window', () => {
    const game = gameWithFoodAt(STREAK_WINDOW + 1);
    expect(game.streak).toBe(1);
    expect(game.multiplier).toBe(1);
  });
});

describe('graph mode', () => {
  const emptyGrid = () => Array.from({ length: 52 }, () => new Array(7).fill(0));

  it('wins when all cells are eaten', () => {
    // Single food cell directly in the snake's path.
    const grid = emptyGrid();
    const probe = createGame({ mode: 'graph', seed: 1, graph: grid });
    const head = probe.snake[0];
    grid[head.x + 1][head.y] = 4;
    const game = createGame({ mode: 'graph', seed: 1, graph: grid });
    expect(game.totalCells).toBe(1);
    const ev = step(game);
    expect(ev.won).toBe(true);
    expect(game.won).toBe(true);
    expect(game.score).toBe(20); // level-4 cell
  });

  it('does not award a week bonus for a single-cell column', () => {
    const grid = emptyGrid();
    grid[27][3] = 4; // lone cell directly ahead of the head at (26,3)
    const game = createGame({ mode: 'graph', seed: 1, graph: grid });
    expect(game.totalCells).toBe(1);
    const ev = step(game); // eat it — its column only ever had one cell
    expect(ev.won).toBe(true);
    expect(ev.weekCleared).toBeFalsy();
    expect(game.score).toBe(20);
  });

  it('awards a multiplier-scaled bonus for clearing a whole week', () => {
    const grid = emptyGrid();
    // A two-cell week at column 28, plus a lone distractor so clearing the
    // week doesn't also empty the board.
    grid[28][3] = 1;
    grid[28][4] = 1;
    grid[30][3] = 1;
    const game = createGame({ mode: 'graph', seed: 1, graph: grid });
    expect(game.totalCells).toBe(3);
    step(game);              // (27,3) — empty
    const eat1 = step(game); // (28,3) — column 28: 2 -> 1, no clear yet
    expect(eat1.weekCleared).toBeFalsy();
    expect(queueInput(game, 2)).toBe(true); // turn down
    const eat2 = step(game); // (28,4) — clears column 28
    expect(eat2.weekCleared).toBe(true);
    expect(eat2.weekCol).toBe(28);
    expect(eat2.weekBonus).toBe(16); // 2 cells * 8 * 1x multiplier
    expect(eat2.won).toBeFalsy();    // distractor cell remains
    // 5 (eat1) + 5 (eat2) + 16 (week bonus) at a 1x multiplier.
    expect(game.score).toBe(26);
  });

  it('clears the final week and wins in the same step, with the bonus applied', () => {
    const grid = emptyGrid();
    grid[28][3] = 1;
    grid[28][4] = 1;
    const game = createGame({ mode: 'graph', seed: 1, graph: grid });
    expect(game.totalCells).toBe(2);
    step(game);              // (27,3)
    step(game);              // (28,3) — 2 -> 1
    expect(queueInput(game, 2)).toBe(true);
    const ev = step(game);   // (28,4) — clears the week and empties the board
    expect(ev.won).toBe(true);
    expect(ev.weekCleared).toBe(true);
    expect(ev.weekBonus).toBe(16);
    expect(game.won).toBe(true);
    expect(game.score).toBe(26);
  });

  it('replays a graph run with a week bonus to an identical score', () => {
    const grid = emptyGrid();
    grid[28][3] = 1;
    grid[28][4] = 1;
    grid[30][3] = 1;
    const live = createGame({ mode: 'graph', seed: 1, graph: grid });
    step(live);              // (27,3)
    step(live);              // (28,3)
    queueInput(live, 2);     // logged input — turn down into the week
    while (live.alive && !live.won) step(live); // run to the end
    const replay = replayGame({ mode: 'graph', seed: 1, graph: grid }, live.inputLog);
    expect(replay.score).toBe(live.score);
    expect(replay.stepCount).toBe(live.stepCount);
    expect(replay.won).toBe(live.won);
  });

  it('ramps speed by cells cleared, not score — a dense graph stays calm early', () => {
    // Fill the whole board so the snake eats a cell on every step (worst case).
    const grid = Array.from({ length: 52 }, () => new Array(7).fill(4));
    const game = createGame({ mode: 'graph', seed: 1, graph: grid });
    for (let i = 0; i < 5; i++) step(game); // ~5 of ~359 cells (~1.4% cleared)
    // Score has snowballed well past a level's worth (the old score-based ramp
    // would have sped up by now), but progress is tiny so the pace stays calm.
    expect(game.score).toBeGreaterThan(50);
    expect(game.level).toBe(1);
    expect(game.speed).toBe(BASE_SPEED);
  });

  it('reaches MIN_SPEED only in the final stretch of the board', () => {
    const grid = Array.from({ length: 52 }, () => new Array(7).fill(0));
    const probe = createGame({ mode: 'graph', seed: 1, graph: grid });
    const { x, y } = probe.snake[0];
    const N = 20;
    for (let k = 1; k <= N; k++) grid[x + k][y] = 1; // straight run in the path
    const game = createGame({ mode: 'graph', seed: 1, graph: grid });
    expect(game.totalCells).toBe(N);
    expect(game.speed).toBe(BASE_SPEED); // starts calm
    for (let i = 0; i < 18; i++) step(game); // clear 90%
    expect(game.won).toBe(false);
    expect(game.speed).toBe(MIN_SPEED); // fast finish
  });
});

describe('variants', () => {
  it('wrap-around carries the snake across the edge instead of killing it', () => {
    const game = createGame({ mode: 'classic', seed: 1, wrap: true });
    const startX = game.snake[0].x;
    // Run right for more than a full board width — must survive and wrap.
    for (let i = 0; i < game.cols + 2; i++) step(game);
    expect(game.alive).toBe(true);
    expect(game.snake[0].x).toBeLessThan(game.cols);
    expect(game.snake[0].x).not.toBe(startX + game.cols + 2);
  });

  it('chill speed scales tick duration and pacing time', () => {
    const normal = createGame({ mode: 'classic', seed: 1 });
    const chill = createGame({ mode: 'classic', seed: 1, speedFactor: 1.5 });
    expect(chill.speed).toBe(normal.speed * 1.5);
    step(normal);
    step(chill);
    expect(chill.elapsedGameMs).toBe(normal.elapsedGameMs * 1.5);
  });
});

describe('validateInputLog', () => {
  it('accepts a legitimate log', () => {
    const run = playBotRun(42);
    expect(validateInputLog(run.inputLog)).toBe(true);
    expect(validateInputLog([])).toBe(true);
  });

  it('rejects malformed logs', () => {
    expect(validateInputLog(null)).toBe(false);
    expect(validateInputLog('nope')).toBe(false);
    expect(validateInputLog([{ s: -1, d: 0 }])).toBe(false);
    expect(validateInputLog([{ s: 0, d: 4 }])).toBe(false);
    expect(validateInputLog([{ s: 5, d: 0 }, { s: 3, d: 1 }])).toBe(false); // non-monotonic
    expect(validateInputLog([{ s: 1.5, d: 0 }])).toBe(false);
    expect(validateInputLog(new Array(20001).fill({ s: 0, d: 0 }))).toBe(false);
  });
});

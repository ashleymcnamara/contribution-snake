import { describe, it, expect } from 'vitest';
import {
  createGame, queueInput, step, replayGame, validateInputLog,
  STREAK_WINDOW, BASE_SPEED, MIN_SPEED,
  CURRENT_RULES, GOLDEN_EVERY, GOLDEN_TTL, GOLDEN_TIME_MS, GOLDEN_MIN_TTL, GOLDEN_POINTS,
  ROTTEN_EVERY, ROTTEN_TTL, ROTTEN_PENALTY,
} from '../src/game/core.js';
import { playBotRun } from './helpers.js';

describe('deterministic core', () => {
  it('replays a run to an identical final state', () => {
    for (const seed of [1, 42, 777, 123456]) {
      const live = playBotRun(seed);
      expect(live.alive).toBe(false);
      const replayed = replayGame({ mode: 'classic', seed, rules: CURRENT_RULES }, live.inputLog);
      expect(replayed.score).toBe(live.score);
      expect(replayed.stepCount).toBe(live.stepCount);
      expect(replayed.snake.length).toBe(live.snake.length);
      expect(replayed.bestStreak).toBe(live.bestStreak);
      expect(replayed.elapsedGameMs).toBe(live.elapsedGameMs);
    }
  });

  it('replays legacy v1 runs under v1 rules to an identical final state', () => {
    for (const seed of [1, 42, 777]) {
      const live = playBotRun(seed, { rules: 1 });
      expect(live.alive).toBe(false);
      // replayGame defaults to v1 for stored runs that predate versioning.
      const replayed = replayGame({ mode: 'classic', seed }, live.inputLog);
      expect(replayed.score).toBe(live.score);
      expect(replayed.stepCount).toBe(live.stepCount);
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

  it('dies on wall collision and reports the cause', () => {
    const game = createGame({ mode: 'classic', seed: 1 });
    let ev = {};
    while (game.alive) ev = step(game); // runs right into the wall
    expect(ev.died).toBe(true);
    expect(ev.cause).toBe('wall');
    expect(game.alive).toBe(false);
  });
});

describe('rules v2: tail forgiveness', () => {
  // A 2x2 loop about to close: head at (5,5) moving right into the tail cell
  // (6,5), which the tail vacates this same step.
  function loopedGame(rules) {
    const game = createGame({ mode: 'classic', seed: 1, rules });
    game.snake = [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 6, y: 6 }, { x: 6, y: 5 }];
    game.dir = 1;
    game.food = { x: 0, y: 0 };
    return game;
  }

  it('v2 lets the head follow the vacating tail', () => {
    const game = loopedGame(2);
    const ev = step(game);
    expect(ev.died).toBeUndefined();
    expect(game.alive).toBe(true);
    expect(game.snake[0]).toEqual({ x: 6, y: 5 });
  });

  it('v1 still dies in the same spot', () => {
    const game = loopedGame(1);
    const ev = step(game);
    expect(ev.died).toBe(true);
    expect(ev.cause).toBe('self');
  });

  it('still dies when the tail cell holds food (the snake grows)', () => {
    const game = loopedGame(2);
    game.food = { x: 6, y: 5 }; // eating means the tail does not vacate
    const ev = step(game);
    expect(ev.died).toBe(true);
    expect(ev.cause).toBe('self');
  });
});

describe('rules v2: golden commits', () => {
  // Feed the snake by teleporting food in front of the head repeatedly.
  function eatFoods(game, count) {
    for (let i = 0; i < count; i++) {
      game.food = { x: game.snake[0].x + 1, y: game.snake[0].y };
      step(game);
    }
  }

  it('spawns after every GOLDEN_EVERY-th food, with a time-normalized TTL (v3)', () => {
    const game = createGame({ mode: 'classic', seed: 7 });
    eatFoods(game, GOLDEN_EVERY - 1);
    expect(game.golden).toBeNull();
    eatFoods(game, 1);
    expect(game.golden).not.toBeNull();
    // ~GOLDEN_TIME_MS of wall-clock at the speed it spawned at.
    expect(game.golden.ttl).toBe(Math.max(GOLDEN_MIN_TTL, Math.round(GOLDEN_TIME_MS / game.speed)));
  });

  it('keeps the fixed step TTL under v2 rules for old replays', () => {
    const game = createGame({ mode: 'classic', seed: 7, rules: 2 });
    eatFoods(game, GOLDEN_EVERY);
    expect(game.golden.ttl).toBe(GOLDEN_TTL);
  });

  it('never spawns under v1 rules', () => {
    const game = createGame({ mode: 'classic', seed: 7, rules: 1 });
    eatFoods(game, GOLDEN_EVERY * 2);
    expect(game.golden).toBeNull();
  });

  it('awards multiplied bonus points and grows the snake when eaten', () => {
    const game = createGame({ mode: 'classic', seed: 7 });
    game.golden = { x: game.snake[0].x + 1, y: game.snake[0].y, ttl: 10 };
    game.food = { x: 0, y: 0 };
    const scoreBefore = game.score;
    const lenBefore = game.snake.length;
    const ev = step(game);
    expect(ev.ate).toBe(true);
    expect(ev.golden).toBe(true);
    expect(game.score - scoreBefore).toBe(Math.ceil(GOLDEN_POINTS * game.multiplier));
    expect(game.snake.length).toBe(lenBefore + 1);
    expect(game.golden).toBeNull();
  });

  it('expires when its TTL runs out', () => {
    const game = createGame({ mode: 'classic', seed: 7 });
    game.golden = { x: 0, y: 0, ttl: 2 };
    game.food = { x: 35, y: 21 }; // out of the way
    step(game);
    expect(game.golden?.ttl).toBe(1);
    step(game);
    expect(game.golden).toBeNull();
  });

  it('counts golden commits eaten and reports spawns', () => {
    const game = createGame({ mode: 'classic', seed: 7 });
    let spawned = false;
    for (let i = 0; i < GOLDEN_EVERY; i++) {
      game.food = { x: game.snake[0].x + 1, y: game.snake[0].y };
      spawned = !!step(game).goldenSpawned || spawned;
    }
    expect(spawned).toBe(true);
    game.golden = { x: game.snake[0].x + 1, y: game.snake[0].y, ttl: 10 };
    step(game);
    expect(game.goldenEaten).toBe(1);
  });
});

describe('rotten-commit variant (unranked)', () => {
  function eatFoods(game, count) {
    for (let i = 0; i < count; i++) {
      game.food = { x: game.snake[0].x + 1, y: game.snake[0].y };
      step(game);
    }
  }

  it('spawns a hazard after every ROTTEN_EVERY-th eat, variant only', () => {
    const off = createGame({ mode: 'classic', seed: 11 });
    eatFoods(off, ROTTEN_EVERY * 2);
    expect(off.rotten).toBeNull();

    const on = createGame({ mode: 'classic', seed: 11, rotten: true });
    eatFoods(on, ROTTEN_EVERY - 1);
    expect(on.rotten).toBeNull();
    eatFoods(on, 1);
    expect(on.rotten).not.toBeNull();
    expect(on.rotten.ttl).toBe(ROTTEN_TTL);
  });

  it('zeroes the streak and charges points without growing the snake', () => {
    const game = createGame({ mode: 'classic', seed: 11, rotten: true });
    game.score = 100;
    game.streak = 6;
    game.multiplier = 2;
    game.rotten = { x: game.snake[0].x + 1, y: game.snake[0].y, ttl: 10 };
    game.food = { x: 0, y: 0 };
    const lenBefore = game.snake.length;
    const ev = step(game);
    expect(ev.rotten).toBe(true);
    expect(game.score).toBe(100 - ROTTEN_PENALTY);
    expect(game.streak).toBe(0);
    expect(game.multiplier).toBe(1);
    expect(game.snake.length).toBe(lenBefore); // hazard is not food
    expect(game.rotten).toBeNull();
  });

  it('score never goes negative', () => {
    const game = createGame({ mode: 'classic', seed: 11, rotten: true });
    game.score = 5;
    game.rotten = { x: game.snake[0].x + 1, y: game.snake[0].y, ttl: 10 };
    game.food = { x: 0, y: 0 };
    step(game);
    expect(game.score).toBe(0);
  });

  it('stays deterministic: same seed + inputs = same outcome', () => {
    const a = createGame({ mode: 'classic', seed: 123, rotten: true });
    const b = createGame({ mode: 'classic', seed: 123, rotten: true });
    for (let i = 0; i < 200 && a.alive; i++) {
      // Zig-zag so both games cover ground and trigger spawns identically.
      if (i % 9 === 0) { queueInput(a, i % 18 === 0 ? 0 : 2); queueInput(b, i % 18 === 0 ? 0 : 2); }
      step(a);
      step(b);
    }
    expect(a.score).toBe(b.score);
    expect(a.snake).toEqual(b.snake);
    expect(a.rotten).toEqual(b.rotten);
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
  it('wins when all cells are eaten', () => {
    // Single food cell directly in the snake's path.
    const grid = Array.from({ length: 52 }, () => new Array(7).fill(0));
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

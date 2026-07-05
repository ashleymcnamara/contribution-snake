// Deterministic game core — shared between the browser and the server's
// replay validator. Everything in here must be a pure function of the seed
// and the input log: no Math.random, no Date.now, no DOM.
import { mulberry32 } from './rng.js';

export const DIRS = [
  { x: 0, y: -1 }, // 0 up
  { x: 1, y: 0 },  // 1 right
  { x: 0, y: 1 },  // 2 down
  { x: -1, y: 0 }, // 3 left
];

export const CLASSIC_COLS = 36;
export const CLASSIC_ROWS = 22;
export const GRAPH_COLS = 52;
export const GRAPH_ROWS = 7;

export const BASE_SPEED = 120; // ms per step at level 1
export const MIN_SPEED = 50;
const START_LENGTH = 5;
// Level at which the speed ramp bottoms out at MIN_SPEED
// (BASE_SPEED - (SPEED_LEVELS - 1) * 8 <= MIN_SPEED).
const SPEED_LEVELS = 10;
// Steps (not wall-clock) between food pickups that keep a streak alive.
// Tick-based so pausing can't break a streak and replays are deterministic.
export const STREAK_WINDOW = 40;
export const MAX_REPLAY_STEPS = 100000;

/**
 * @typedef {Object} GameState
 * @property {'classic'|'daily'|'graph'} mode
 * @property {number} cols  @property {number} rows
 * @property {() => number} rng  Seeded PRNG — the only randomness source.
 * @property {number} seed
 * @property {{x:number,y:number}[]} snake  Head first.
 * @property {number} dir  Index into DIRS.
 * @property {number[]} queue  Pending validated direction inputs.
 * @property {{s:number,d:number}[]} inputLog  Accepted inputs by step index.
 * @property {{x:number,y:number}|null} food  Classic/daily only.
 * @property {Map<string,number>|null} cells  Graph mode: "x,y" -> level 1-4.
 * @property {number} totalCells  Graph mode: initial food-cell count.
 * @property {number} score  @property {number} streak  @property {number} bestStreak
 * @property {number} multiplier  @property {number} level
 * @property {number} speed  ms per step at the current level.
 * @property {number} stepCount  @property {number} stepsSinceFood
 * @property {number} elapsedGameMs  Minimum wall-clock ms this run must have
 *   taken (sum of per-step speeds) — used by the server's pacing check.
 * @property {boolean} alive  @property {boolean} won
 */

// Points for eating a contribution cell of a given intensity in graph mode.
const GRAPH_LEVEL_POINTS = [0, 5, 10, 15, 20];

export function boardSize(mode) {
  return mode === 'graph'
    ? { cols: GRAPH_COLS, rows: GRAPH_ROWS }
    : { cols: CLASSIC_COLS, rows: CLASSIC_ROWS };
}

// graph: for 'graph' mode, a cols x rows array of contribution levels 0-4.
// wrap / speedFactor are unranked variants — server sessions always replay
// with the defaults, so variant runs can never reach the leaderboard.
export function createGame({ mode = 'classic', seed = 1, graph = null, wrap = false, speedFactor = 1 }) {
  const { cols, rows } = boardSize(mode);
  const startX = Math.floor(cols / 2);
  const startY = Math.floor(rows / 2);
  const snake = [];
  for (let i = 0; i < START_LENGTH; i++) {
    snake.push({ x: startX - i, y: startY });
  }

  const state = {
    mode,
    cols,
    rows,
    rng: mulberry32(seed),
    seed,
    snake,
    dir: 1, // right
    queue: [],
    inputLog: [],
    food: null,
    cells: null,
    totalCells: 0,
    score: 0,
    streak: 0,
    bestStreak: 0,
    multiplier: 1,
    level: 1,
    wrap,
    speedFactor,
    speed: BASE_SPEED * speedFactor,
    stepCount: 0,
    stepsSinceFood: 0,
    elapsedGameMs: 0,
    alive: true,
    won: false,
  };

  if (mode === 'graph') {
    state.cells = new Map();
    for (let x = 0; x < cols; x++) {
      for (let y = 0; y < rows; y++) {
        const lvl = graph?.[x]?.[y] || 0;
        // Don't bury food under the starting snake.
        const onSnake = snake.some((s) => s.x === x && s.y === y);
        if (lvl > 0 && !onSnake) state.cells.set(`${x},${y}`, lvl);
      }
    }
    state.totalCells = state.cells.size;
  } else {
    placeFood(state);
  }

  return state;
}

function placeFood(state) {
  const occupied = new Set(state.snake.map((s) => `${s.x},${s.y}`));
  let pos;
  do {
    pos = {
      x: Math.floor(state.rng() * state.cols),
      y: Math.floor(state.rng() * state.rows),
    };
  } while (occupied.has(`${pos.x},${pos.y}`));
  state.food = pos;
}

// Validated direction queue — prevents 180° reversals from fast key presses.
// Returns true if the input was accepted (callers use this to log/replay).
export function queueInput(state, d, log = true) {
  if (!state.alive || state.won) return false;
  const last = state.queue.length ? state.queue[state.queue.length - 1] : state.dir;
  const cur = DIRS[d];
  const prev = DIRS[last];
  if (cur.x === -prev.x && cur.y === -prev.y) return false; // no reversing
  if (d === last) return false; // no duplicates
  if (state.queue.length >= 3) return false;
  state.queue.push(d);
  if (log) state.inputLog.push({ s: state.stepCount, d });
  return true;
}

function onEat(state, basePoints) {
  if (state.stepsSinceFood <= STREAK_WINDOW) {
    state.streak++;
  } else {
    state.streak = 1;
  }
  state.bestStreak = Math.max(state.bestStreak, state.streak);
  state.multiplier = 1 + Math.floor(state.streak / 3) * 0.5;
  const points = Math.ceil(basePoints * state.multiplier);
  state.score += points;
  state.stepsSinceFood = 0;

  const newLevel = graphLevelFrom(state);
  let levelUp = false;
  if (newLevel > state.level) {
    state.level = newLevel;
    state.speed = Math.max(MIN_SPEED, BASE_SPEED - (state.level - 1) * 8) * state.speedFactor;
    levelUp = true;
  }
  return { points, levelUp };
}

// How fast the game runs. Classic/daily ramp with raw score. Graph mode ramps
// with how much of the board you've *cleared*, not score — otherwise a dense
// graph (hundreds of adjacent cells) snowballs the multiplier and slams into
// MIN_SPEED within a couple of seconds, which feels frantic and glitchy. Tying
// it to progress paces every graph, dense or sparse, from calm to a fast finish
// (top speed over the final ~10% of cells).
function graphLevelFrom(state) {
  if (state.mode !== 'graph') return Math.floor(state.score / 50) + 1;
  if (!state.totalCells) return SPEED_LEVELS;
  const cleared = (state.totalCells - state.cells.size) / state.totalCells;
  return Math.min(SPEED_LEVELS, Math.floor(cleared * SPEED_LEVELS) + 1);
}

// Advance one tick. Returns an event object the UI uses for effects/sound.
export function step(state) {
  if (!state.alive || state.won) return { done: true };

  if (state.queue.length) state.dir = state.queue.shift();
  const dir = DIRS[state.dir];
  const head = { x: state.snake[0].x + dir.x, y: state.snake[0].y + dir.y };
  state.stepCount++;
  // Each step takes at least `speed` ms of real time on an honest client.
  state.elapsedGameMs += state.speed;

  // Wall collision (or wrap-around in the variant)
  if (head.x < 0 || head.x >= state.cols || head.y < 0 || head.y >= state.rows) {
    if (state.wrap) {
      head.x = (head.x + state.cols) % state.cols;
      head.y = (head.y + state.rows) % state.rows;
    } else {
      state.alive = false;
      return { died: true };
    }
  }
  // Self collision
  for (const seg of state.snake) {
    if (seg.x === head.x && seg.y === head.y) {
      state.alive = false;
      return { died: true };
    }
  }

  state.snake.unshift(head);

  let ate = false;
  let eatEvent = null;
  if (state.mode === 'graph') {
    const key = `${head.x},${head.y}`;
    const lvl = state.cells.get(key);
    if (lvl) {
      state.cells.delete(key);
      eatEvent = onEat(state, GRAPH_LEVEL_POINTS[lvl]);
      ate = true;
      if (state.cells.size === 0) {
        state.won = true;
        return { ate, ...eatEvent, won: true, head };
      }
    }
  } else if (head.x === state.food.x && head.y === state.food.y) {
    eatEvent = onEat(state, 10);
    ate = true;
    placeFood(state);
  }

  if (ate) return { ate, ...eatEvent, head };

  state.snake.pop();
  state.stepsSinceFood++;
  return { head };
}

// Server-side validation: rebuild the game from the seed and the input log,
// and return the final state. A legitimate submission always ends in death
// (scores are submitted from the game-over screen).
export function replayGame({ mode, seed, graph }, inputLog) {
  const state = createGame({ mode, seed, graph });
  let i = 0;
  while (state.alive && !state.won && state.stepCount < MAX_REPLAY_STEPS) {
    while (i < inputLog.length && inputLog[i].s === state.stepCount) {
      queueInput(state, inputLog[i].d, false);
      i++;
    }
    step(state);
  }
  return state;
}

// Basic shape check on an input log before replaying it.
export function validateInputLog(inputLog) {
  if (!Array.isArray(inputLog) || inputLog.length > 20000) return false;
  let prev = -1;
  for (const entry of inputLog) {
    if (typeof entry !== 'object' || entry === null) return false;
    const { s, d } = entry;
    if (!Number.isInteger(s) || s < 0 || s < prev) return false;
    if (!Number.isInteger(d) || d < 0 || d > 3) return false;
    prev = s;
  }
  return true;
}

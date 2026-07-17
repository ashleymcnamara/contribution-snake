// Deterministic game core — shared between the browser and the server's
// replay validator. Everything in here must be a pure function of the seed
// and the input log: no Math.random, no Date.now, no DOM.
import { mulberry32 } from './rng.js';
import { dailyBriefFor } from './daily.js';

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

// Rules versioning: gameplay changes that alter determinism bump this, and
// every stored run (server session/replay, local best run) records the rules
// it was played under so old input logs still replay to the same final state.
//   v1 — original rules.
//   v2 — tail forgiveness (the head may enter the cell the tail is vacating
//        this step) and golden commits (a timed bonus food in classic/daily).
//   v3 — golden TTL is time-normalized: ~GOLDEN_TIME_MS of wall-clock at the
//        speed it spawned at, instead of a fixed step count. Fixed steps gave
//        7.2s of thinking time at level 1 but only 3s at top speed — exactly
//        backwards for difficulty.
//   v4 — deterministic Daily briefs and Classic power-ups. Rebase rewinds
//        movement only, preserving logical time and RNG state so replay input
//        indices remain monotonic.
export const CURRENT_RULES = 4;

// Golden commits (rules >= 2, classic/daily only): every GOLDEN_EVERY-th
// normal food spawns a bonus cell worth GOLDEN_POINTS base points that
// disappears after GOLDEN_TTL steps (v2) or ~GOLDEN_TIME_MS of play (v3+).
export const GOLDEN_EVERY = 5;
export const GOLDEN_TTL = 60;
export const GOLDEN_TIME_MS = 4500;
export const GOLDEN_MIN_TTL = 20;
export const GOLDEN_POINTS = 50;

// Rotten commits (unranked variant, opt-in): every ROTTEN_EVERY-th eat spawns
// a timed hazard cell; running into it zeroes the streak and costs points.
// Kept out of the versioned ranked rules while the mechanic is on trial —
// variant runs never reach the server, so no rules bump is needed.
export const ROTTEN_EVERY = 3;
export const ROTTEN_TTL = 80;
export const ROTTEN_PENALTY = 25;

// Ranked Classic power-ups (rules >= 4). They are deterministic, so the server
// can replay them exactly like food and golden commits.
export const POWERUP_EVERY = 4;
export const POWERUP_TTL = 90;
export const FORK_TTL = 60;
export const REBASE_TIME_MS = 3000;
const MAX_REBASE_HISTORY = 120;
const POWERUP_TYPES = ['rebase', 'fork', 'squash'];

/**
 * @typedef {Object} GameState
 * @property {'classic'|'daily'|'graph'|'campaign'} mode
 * @property {number} cols  @property {number} rows
 * @property {() => number} rng  Seeded PRNG — the only randomness source.
 * @property {number} seed
 * @property {{x:number,y:number}[]} snake  Head first.
 * @property {number} dir  Index into DIRS.
 * @property {number[]} queue  Pending validated direction inputs.
 * @property {{s:number,d:number}[]} inputLog  Accepted inputs by step index.
 * @property {{x:number,y:number}|null} food  Classic/daily only.
 * @property {{x:number,y:number,ttl:number}|null} golden  Timed bonus food (rules >= 2).
 * @property {number} goldenEaten  Golden commits eaten this run.
 * @property {boolean} rottenVariant  Hazard variant enabled (unranked).
 * @property {{x:number,y:number,ttl:number}|null} rotten  Active hazard cell.
 * @property {number} foodEaten  Foods/cells eaten — paces golden and hazard spawns.
 * @property {number} rules  Gameplay rules version this game runs under.
 * @property {Map<string,number>|null} cells  Graph mode: "x,y" -> level 1-4.
 * @property {number} totalCells  Graph mode: initial food-cell count.
 * @property {number} score  @property {number} streak  @property {number} bestStreak
 * @property {number} multiplier  @property {number} level
 * @property {number} speed  ms per step at the current level.
 * @property {number} stepCount  @property {number} stepsSinceFood
 * @property {number} elapsedGameMs  Minimum wall-clock ms this run must have
 *   taken (sum of per-step speeds) — used by the server's pacing check.
 * @property {Set<string>} walls  Campaign obstacle cells.
 * @property {{x:number,y:number,type:string,ttl:number}|null} powerUp
 * @property {number} rebaseCharges  @property {number} forkTicks
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
// rules: gameplay version (see CURRENT_RULES); pass a stored run's rules when
// replaying it so old logs reproduce their original outcome.
// rotten: the unranked hazard variant — see ROTTEN_* above.
export function createGame({
  mode = 'classic', seed = 1, graph = null,
  wrap = false, speedFactor = 1, rotten = false, rules = CURRENT_RULES,
  day = null, walls = null, targetFood = 0, campaignId = null,
}) {
  const { cols, rows } = boardSize(mode);
  const startX = Math.floor(cols / 2);
  const startY = Math.floor(rows / 2);
  const snake = [];
  for (let i = 0; i < START_LENGTH; i++) {
    snake.push({ x: startX - i, y: startY });
  }

  const dailyBrief = mode === 'daily' ? dailyBriefFor(day || String(seed), rules) : null;
  const effectiveSpeedFactor = speedFactor * (dailyBrief?.speedFactor || 1);
  const wallSet = new Set();
  const snakeCells = new Set(snake.map((s) => `${s.x},${s.y}`));
  for (const wall of walls || []) {
    if (!Number.isInteger(wall?.x) || !Number.isInteger(wall?.y)) continue;
    if (wall.x < 0 || wall.x >= cols || wall.y < 0 || wall.y >= rows) continue;
    const key = `${wall.x},${wall.y}`;
    if (!snakeCells.has(key)) wallSet.add(key);
  }

  const state = {
    mode,
    day,
    cols,
    rows,
    rng: mulberry32(seed),
    seed,
    rules,
    snake,
    dir: 1, // right
    queue: [],
    inputLog: [],
    food: null,
    golden: null, // { x, y, ttl } bonus food (rules >= 2, classic/daily)
    goldenEaten: 0,
    rottenVariant: rotten,
    rotten: null, // { x, y, ttl } hazard cell (rotten variant only)
    foodEaten: 0,
    cells: null,
    totalCells: 0,
    score: 0,
    streak: 0,
    bestStreak: 0,
    multiplier: 1,
    level: 1,
    wrap,
    speedFactor,
    effectiveSpeedFactor,
    speed: BASE_SPEED * effectiveSpeedFactor,
    dailyBrief,
    walls: wallSet,
    targetFood: Math.max(0, Number(targetFood) || 0),
    campaignId,
    powerUpsEnabled: rules >= 4 && (mode === 'classic' || mode === 'campaign'),
    powerUp: null,
    powerUpsCollected: { rebase: 0, fork: 0, squash: 0 },
    rebaseCharges: 0,
    forkTicks: 0,
    positionHistory: [],
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
  for (const key of state.walls) occupied.add(key);
  if (state.golden) occupied.add(`${state.golden.x},${state.golden.y}`);
  if (state.rotten) occupied.add(`${state.rotten.x},${state.rotten.y}`);
  if (state.powerUp) occupied.add(`${state.powerUp.x},${state.powerUp.y}`);
  let pos;
  do {
    pos = {
      x: Math.floor(state.rng() * state.cols),
      y: Math.floor(state.rng() * state.rows),
    };
  } while (occupied.has(`${pos.x},${pos.y}`));
  state.food = pos;
}

// v3+: constant thinking time — the TTL covers ~GOLDEN_TIME_MS at the speed
// the golden spawned at. v2 keeps the original fixed step count so old
// replays reproduce exactly.
function goldenTtlFor(state) {
  if (state.rules < 3) return GOLDEN_TTL;
  const factor = state.dailyBrief?.goldenTtlFactor || 1;
  return Math.max(GOLDEN_MIN_TTL, Math.round((GOLDEN_TIME_MS * factor) / state.speed));
}

function placeGolden(state) {
  const occupied = new Set(state.snake.map((s) => `${s.x},${s.y}`));
  for (const key of state.walls) occupied.add(key);
  occupied.add(`${state.food.x},${state.food.y}`);
  if (state.rotten) occupied.add(`${state.rotten.x},${state.rotten.y}`);
  if (state.powerUp) occupied.add(`${state.powerUp.x},${state.powerUp.y}`);
  let pos;
  do {
    pos = {
      x: Math.floor(state.rng() * state.cols),
      y: Math.floor(state.rng() * state.rows),
    };
  } while (occupied.has(`${pos.x},${pos.y}`));
  state.golden = { ...pos, ttl: goldenTtlFor(state) };
}

function placeRotten(state) {
  const occupied = new Set(state.snake.map((s) => `${s.x},${s.y}`));
  for (const key of state.walls) occupied.add(key);
  if (state.food) occupied.add(`${state.food.x},${state.food.y}`);
  if (state.golden) occupied.add(`${state.golden.x},${state.golden.y}`);
  if (state.powerUp) occupied.add(`${state.powerUp.x},${state.powerUp.y}`);
  // Graph mode: hazards only land on empty (already-eaten or blank) cells.
  if (state.cells) for (const key of state.cells.keys()) occupied.add(key);
  // Defensive: a nearly-full board has nowhere safe to put a hazard.
  if (occupied.size >= state.cols * state.rows - 1) return;
  let pos;
  do {
    pos = {
      x: Math.floor(state.rng() * state.cols),
      y: Math.floor(state.rng() * state.rows),
    };
  } while (occupied.has(`${pos.x},${pos.y}`));
  state.rotten = { ...pos, ttl: ROTTEN_TTL };
}

function placePowerUp(state) {
  const occupied = new Set(state.snake.map((s) => `${s.x},${s.y}`));
  for (const key of state.walls) occupied.add(key);
  if (state.food) occupied.add(`${state.food.x},${state.food.y}`);
  if (state.golden) occupied.add(`${state.golden.x},${state.golden.y}`);
  if (state.rotten) occupied.add(`${state.rotten.x},${state.rotten.y}`);
  let pos;
  do {
    pos = {
      x: Math.floor(state.rng() * state.cols),
      y: Math.floor(state.rng() * state.rows),
    };
  } while (occupied.has(`${pos.x},${pos.y}`));
  const type = POWERUP_TYPES[Math.floor(state.rng() * POWERUP_TYPES.length)];
  state.powerUp = { ...pos, type, ttl: POWERUP_TTL };
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
  const streakWindow = state.dailyBrief?.streakWindow || STREAK_WINDOW;
  if (state.stepsSinceFood <= streakWindow) {
    state.streak++;
  } else {
    state.streak = 1;
  }
  state.bestStreak = Math.max(state.bestStreak, state.streak);
  const multiplierStep = state.dailyBrief?.multiplierStep || 0.5;
  state.multiplier = 1 + Math.floor(state.streak / 3) * multiplierStep;
  const scoreFactor = state.dailyBrief?.scoreFactor || 1;
  const forkFactor = state.forkTicks > 0 ? 2 : 1;
  const points = Math.ceil(basePoints * state.multiplier * scoreFactor * forkFactor);
  state.score += points;
  state.stepsSinceFood = 0;

  const newLevel = graphLevelFrom(state);
  let levelUp = false;
  if (newLevel > state.level) {
    state.level = newLevel;
    state.speed = Math.max(MIN_SPEED, BASE_SPEED - (state.level - 1) * 8)
      * state.effectiveSpeedFactor;
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
  if (state.mode !== 'graph') {
    const levelEvery = state.dailyBrief?.levelEvery || 50;
    return Math.floor(state.score / levelEvery) + 1;
  }
  if (!state.totalCells) return SPEED_LEVELS;
  const cleared = (state.totalCells - state.cells.size) / state.totalCells;
  return Math.min(SPEED_LEVELS, Math.floor(cleared * SPEED_LEVELS) + 1);
}

function rememberPosition(state) {
  if (!state.powerUpsEnabled) return;
  state.positionHistory.push({
    snake: state.snake.map((segment) => ({ ...segment })),
    dir: state.dir,
    elapsedGameMs: state.elapsedGameMs,
  });
  if (state.positionHistory.length > MAX_REBASE_HISTORY) state.positionHistory.shift();
}

function resolveCollision(state, cause) {
  if (state.rebaseCharges > 0 && state.positionHistory.length) {
    const targetTime = state.elapsedGameMs - REBASE_TIME_MS;
    let index = 0;
    for (let i = 0; i < state.positionHistory.length; i++) {
      if (state.positionHistory[i].elapsedGameMs <= targetTime) index = i;
      else break;
    }
    const snapshot = state.positionHistory[index];
    state.snake = snapshot.snake.map((segment) => ({ ...segment }));
    state.dir = snapshot.dir;
    state.queue = [];
    state.rebaseCharges--;
    state.positionHistory = state.positionHistory.slice(0, index + 1);
    state.stepsSinceFood++;
    return { rebased: true, cause, head: { ...state.snake[0] } };
  }
  state.alive = false;
  return { died: true, cause };
}

function collectPowerUp(state, type) {
  state.powerUpsCollected[type]++;
  if (type === 'rebase') {
    state.rebaseCharges = Math.min(2, state.rebaseCharges + 1);
    return { charges: state.rebaseCharges };
  }
  if (type === 'fork') {
    state.forkTicks = FORK_TTL;
    return { ticks: state.forkTicks };
  }
  const before = state.snake.length;
  const keep = Math.max(START_LENGTH, Math.ceil(before * 0.6));
  state.snake.splice(keep);
  return { squashed: before - state.snake.length };
}

// Advance one tick. Returns an event object the UI uses for effects/sound.
export function step(state) {
  if (!state.alive || state.won) return { done: true };

  rememberPosition(state);
  if (state.queue.length) state.dir = state.queue.shift();
  const dir = DIRS[state.dir];
  const head = { x: state.snake[0].x + dir.x, y: state.snake[0].y + dir.y };
  state.stepCount++;
  // Each step takes at least `speed` ms of real time on an honest client.
  state.elapsedGameMs += state.speed;

  // Timed cells tick down first so the eat / tail-forgiveness checks below
  // all see the same post-expiry board.
  if (state.golden && --state.golden.ttl <= 0) state.golden = null;
  if (state.rotten && --state.rotten.ttl <= 0) state.rotten = null;
  if (state.powerUp && --state.powerUp.ttl <= 0) state.powerUp = null;
  if (state.forkTicks > 0) state.forkTicks--;

  // Wall collision (or wrap-around in the variant)
  if (head.x < 0 || head.x >= state.cols || head.y < 0 || head.y >= state.rows) {
    if (state.wrap) {
      head.x = (head.x + state.cols) % state.cols;
      head.y = (head.y + state.rows) % state.rows;
    } else {
      return resolveCollision(state, 'wall');
    }
  }

  // Will this step eat? Needed before the self-collision check: under v2
  // rules the head may slide into the cell the tail is vacating, which is
  // only safe when the snake doesn't grow (i.e. doesn't eat) this step.
  const headKey = `${head.x},${head.y}`;
  if (state.walls.has(headKey)) return resolveCollision(state, 'obstacle');
  const willEat = state.mode === 'graph'
    ? state.cells.has(headKey)
    : (head.x === state.food.x && head.y === state.food.y)
      || (state.golden && head.x === state.golden.x && head.y === state.golden.y);

  // Self collision (v2: the vacating tail cell is fair game unless growing)
  const tailPasses = state.rules >= 2 && !willEat;
  for (let i = 0; i < state.snake.length; i++) {
    if (tailPasses && i === state.snake.length - 1) break;
    const seg = state.snake[i];
    if (seg.x === head.x && seg.y === head.y) {
      return resolveCollision(state, 'self');
    }
  }

  state.snake.unshift(head);

  if (state.powerUp && head.x === state.powerUp.x && head.y === state.powerUp.y) {
    const type = state.powerUp.type;
    state.powerUp = null;
    state.snake.pop();
    const result = collectPowerUp(state, type);
    state.stepsSinceFood++;
    return { head, powerUp: type, ...result };
  }

  let ate = false;
  let golden = false;
  let goldenSpawned = false;
  let eatEvent = null;
  if (state.mode === 'graph') {
    const lvl = state.cells.get(headKey);
    if (lvl) {
      state.cells.delete(headKey);
      eatEvent = onEat(state, GRAPH_LEVEL_POINTS[lvl]);
      ate = true;
      state.foodEaten++;
      if (state.cells.size === 0) {
        state.won = true;
        return { ate, ...eatEvent, won: true, head };
      }
    }
  } else if (head.x === state.food.x && head.y === state.food.y) {
    eatEvent = onEat(state, 10);
    ate = true;
    state.foodEaten++;
    if (state.targetFood && state.foodEaten >= state.targetFood) {
      state.won = true;
      return { ate, ...eatEvent, won: true, head };
    }
    placeFood(state);
    const goldenEvery = state.dailyBrief?.goldenEvery || GOLDEN_EVERY;
    if (state.rules >= 2 && !state.golden && state.foodEaten % goldenEvery === 0) {
      placeGolden(state);
      goldenSpawned = true;
    }
  } else if (state.golden && head.x === state.golden.x && head.y === state.golden.y) {
    eatEvent = onEat(state, GOLDEN_POINTS);
    ate = true;
    golden = true;
    state.goldenEaten++;
    state.golden = null;
  }

  // Rotten variant: pace a hazard off the same eat counter.
  if (ate && state.rottenVariant && !state.rotten && state.foodEaten > 0
      && state.foodEaten % ROTTEN_EVERY === 0) {
    placeRotten(state);
  }

  let powerUpSpawned = false;
  if (ate && !golden && state.powerUpsEnabled && !state.powerUp && state.foodEaten > 0
      && state.foodEaten % POWERUP_EVERY === 0) {
    placePowerUp(state);
    powerUpSpawned = true;
  }

  if (ate) return { ate, golden, goldenSpawned, powerUpSpawned, ...eatEvent, head };

  // Hazard hit: not food, so the snake doesn't grow — it just pays for it.
  let rotten = false;
  if (state.rotten && head.x === state.rotten.x && head.y === state.rotten.y) {
    state.rotten = null;
    state.streak = 0;
    state.multiplier = 1;
    state.score = Math.max(0, state.score - ROTTEN_PENALTY);
    rotten = true;
  }

  state.snake.pop();
  state.stepsSinceFood++;
  return { head, rotten };
}

// Server-side validation: rebuild the game from the seed and the input log,
// and return the final state. A legitimate submission ends in death or (graph
// mode) a win. Pass the rules the run was recorded under so old logs replay
// to their original outcome.
export function replayGame({ mode, seed, graph, rules = 1, day = null }, inputLog) {
  const state = createGame({ mode, seed, graph, rules, day });
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

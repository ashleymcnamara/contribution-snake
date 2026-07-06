// Canvas renderer: contribution-graph board, interpolated snake with a
// connected body, particles, floating text, screen shake, death flash,
// combo-window meter, and translucent ghost snakes for replay racing.
import { STREAK_WINDOW } from '../game/core.js';
export const CELL = 14;
export const GAP = 3;
export const STEP_PX = CELL + GAP;
const LABEL_LEFT = 32;
const LABEL_TOP = 18;
const PAD = 4;

// --- "little guy" face geometry (all sized relative to the CELL) ---
const EYE = 6;            // sclera size (rounded square), kept inside the cell
const EYE_RX = 2.5;
const PUPIL = 3;
const GLINT = 1;
const PUPIL_TRACK = 1.3;  // max pupil offset toward food (< (EYE-PUPIL)/2 so it stays inside)
const EYE_LEAD = 1;       // inset from the leading edge
const EYE_GAP = 1;        // gap between the two eyes
const EYE_MARG = (CELL - 2 * EYE - EYE_GAP) / 2; // outer margin on the perpendicular axis
const BLUSH_W = 5;
const BLUSH_H = 4;
const TONGUE_STEM = 3.5;
const TONGUE_PRONG = 3;
const TONGUE_SPREAD = 2;
// Timing (ms) driven by the renderer's own frame clock — never game state.
const BLINK_MS = 120;
const BLINK_MIN = 3500;
const BLINK_VAR = 1500;
const TONGUE_MS = 300;
const TONGUE_INT = 7000;
const TONGUE_VAR = 800;
const NOM_FRAMES = 10;

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const DAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', ''];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const r = {
    canvas,
    ctx,
    cols: 0,
    rows: 0,
    w: 0,
    h: 0,
    // Follow-camera for boards too wide to fit readably (graph mode on
    // phones): null when the whole board fits, else { x, viewW }.
    camera: null,
    theme: null,
    reduceMotion: false,
    // cached offscreen render of the static empty grid (see drawGrid)
    gridCanvas: null,
    gridTheme: null,
    gridCols: 0,
    gridRows: 0,
    // effects state
    particles: [],
    floatingTexts: [],
    foodPulse: 0,
    shakeTimer: 0,
    deathFlashTimer: 0,
    deathSnapshot: null,
    // face state: a renderer-local clock (ms, advanced per draw) drives the
    // blink and tongue-flick timing so they never depend on game state.
    faceClock: 0,
    faceTs: 0,
    nextBlink: BLINK_MIN,
    nextTongue: 4500,
    nomTimer: 0,
  };

  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  r.reduceMotion = motionQuery.matches;
  motionQuery.addEventListener('change', (e) => { r.reduceMotion = e.matches; });

  return r;
}

export function resizeBoard(r, cols, rows) {
  r.cols = cols;
  r.rows = rows;
  r.w = LABEL_LEFT + PAD + cols * STEP_PX + GAP + PAD;
  r.h = LABEL_TOP + PAD + rows * STEP_PX + GAP + PAD;
  r.gridTheme = null; // force the grid cache to rebuild at the new size / dpr
  fitBoard(r);
}

// Size the canvas backing store (only when it actually changes, so redraws
// between frames don't flash a cleared canvas).
function setBacking(r, viewW) {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const bw = Math.round(viewW * dpr);
  const bh = Math.round(r.h * dpr);
  if (r.canvas.width !== bw || r.canvas.height !== bh) {
    r.canvas.width = bw;
    r.canvas.height = bh;
  }
  r.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// Camera threshold: engage only for boards that are both much wider than tall
// (the 52x7 graph, not the 36x22 classic — classic wants whole-board vision)
// and would scale below readable cell size when fitted whole.
const CAM_ASPECT = 4;
const CAM_MIN_SCALE = 0.55;

// Scale the on-screen board to fit within both the available width and the
// available viewport height, preserving the aspect ratio (never upscaled past
// its logical size). Width-only fitting left the board overflowing the screen
// in landscape / on short viewports, pushing the touch controls out of reach;
// fitting height too keeps the whole UI on one screen without page scroll.
// Very wide boards on narrow screens switch to a follow-camera instead of
// shrinking into illegibility: full-size cells, a viewport that tracks the
// head (see draw()).
export function fitBoard(r) {
  const c = r.canvas;
  if (!r.w || !r.h) return;
  const bodyCS = getComputedStyle(document.body);
  const padX = parseFloat(bodyCS.paddingLeft) + parseFloat(bodyCS.paddingRight);
  const padY = parseFloat(bodyCS.paddingTop) + parseFloat(bodyCS.paddingBottom);
  const availW = document.documentElement.clientWidth - padX;
  const availH = window.innerHeight - padY;

  const fullScale = Math.min(1, availW / r.w);
  if (r.cols / Math.max(1, r.rows) >= CAM_ASPECT && fullScale < CAM_MIN_SCALE) {
    // -2 leaves room for the canvas-wrapper border so nothing overflows.
    const viewW = Math.min(r.w, Math.floor(availW) - 2);
    if (r.camera) r.camera.viewW = viewW;
    else r.camera = { x: null, viewW }; // x: null -> snap to the head next draw
    setBacking(r, viewW);
    c.style.width = viewW + 'px';
    c.style.height = r.h + 'px';
    return;
  }

  r.camera = null;
  setBacking(r, r.w);

  // Fit to width first (the usual constraint in portrait), never upscaling.
  let scale = fullScale;
  c.style.width = Math.floor(r.w * scale) + 'px';
  c.style.height = Math.floor(r.h * scale) + 'px';

  // The board is the only flexible element in the column, so any page overflow
  // can be removed by shrinking it by exactly that overflow.
  const container = c.closest('.game-container') || c.parentElement;
  if (!container) return;
  const overflow = container.scrollHeight - availH;
  if (overflow > 4) {
    const curH = r.h * scale;
    const targetH = Math.max(70, curH - overflow);
    scale *= targetH / curH;
    c.style.width = Math.floor(r.w * scale) + 'px';
    c.style.height = Math.floor(r.h * scale) + 'px';
  }
}

// Size a renderer to a fixed social-share frame (default 1200×630, OG-image
// sized) and center the board — scaled to fit `box` — inside it, rather than
// cropping the canvas to the board. A thin graph strip would otherwise embed as
// an ugly sliver on social feeds; this letterboxes it into a proper landscape
// card. `chrome(ctx, game)` is drawn each frame in the card's device space (the
// brand header + live stats), leaving the letterbox filled with the theme bg.
// Only draw() when r.card is set follows this path; the on-screen renderer never
// calls this, so its layout is untouched.
export function sizeToCard(r, cols, rows, {
  width = 1200, height = 630, dpr = 2, box = null, chrome = null,
} = {}) {
  r.cols = cols;
  r.rows = rows;
  r.w = LABEL_LEFT + PAD + cols * STEP_PX + GAP + PAD;
  r.h = LABEL_TOP + PAD + rows * STEP_PX + GAP + PAD;
  r.gridTheme = null;
  r.camera = null; // whole board always in frame — no follow-camera offscreen
  r.canvas.width = Math.round(width * dpr);
  r.canvas.height = Math.round(height * dpr);
  const b = box || { x: 32, y: 32, w: width - 64, h: height - 64 };
  const scale = Math.min(b.w / r.w, b.h / r.h);
  r.card = {
    width, height, dpr, scale, chrome,
    offX: b.x + (b.w - r.w * scale) / 2,
    offY: b.y + (b.h - r.h * scale) / 2,
  };
}

const OX = () => LABEL_LEFT + PAD;
const OY = () => LABEL_TOP + PAD;

function cellPx(x, y) {
  return { px: OX() + x * STEP_PX, py: OY() + y * STEP_PX };
}

function roundedRect(ctx, x, y, w, h, rad) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, rad);
}

// --- effects API (called by main on game events) ---

export function spawnParticles(r, gx, gy, color, count) {
  if (r.reduceMotion) return;
  const { px, py } = cellPx(gx, gy);
  const cx = px + CELL / 2;
  const cy = py + CELL / 2;
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
    const speed = 1.5 + Math.random() * 2.5;
    r.particles.push({
      x: cx, y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 3 + Math.random() * 4,
      life: 1,
      decay: 0.02 + Math.random() * 0.02,
      color,
    });
  }
}

export function spawnFloatingText(r, gx, gy, text, big = false) {
  const { px, py } = cellPx(gx, gy);
  r.floatingTexts.push({
    x: px + CELL / 2,
    y: py,
    text,
    big,
    life: 1,
    decay: big ? 0.012 : 0.018,
  });
}

export function startDeathEffect(r, snake) {
  r.deathSnapshot = snake.map((s) => ({ ...s }));
  r.deathFlashTimer = 30;
  if (!r.reduceMotion) r.shakeTimer = 14;
}

// Happy squint: the head pulls a brief "^^ + blush" face right after eating.
// Frame-counted (like the death flash) so it reads the same at any speed.
export function startNomFace(r) {
  r.nomTimer = NOM_FRAMES;
}

export function clearEffects(r) {
  r.particles = [];
  r.floatingTexts = [];
  r.deathFlashTimer = 0;
  r.deathSnapshot = null;
  r.shakeTimer = 0;
  r.nomTimer = 0;
}

// --- drawing ---

// Month labels scroll with the board under the camera; day labels stay pinned
// to the left edge (drawn outside the camera transform, over a bg strip so
// scrolled cells don't slide beneath the text).
function drawMonthLabels(r, monthly) {
  const { ctx, theme } = r;
  ctx.font = '10px ' + FONT;
  ctx.fillStyle = theme.textMuted;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const labels = monthly || MONTH_LABELS;
  const colsPerLabel = Math.ceil(r.cols / labels.length);
  for (let m = 0; m < labels.length; m++) {
    const col = m * colsPerLabel;
    if (col < r.cols) ctx.fillText(labels[m], OX() + col * STEP_PX, 4);
  }
}

function drawDayLabels(r) {
  const { ctx, theme } = r;
  if (r.camera) {
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, LABEL_TOP, LABEL_LEFT - 2, r.h - LABEL_TOP);
  }
  ctx.font = '10px ' + FONT;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = theme.textMuted;
  ctx.textAlign = 'right';
  for (let row = 0; row < Math.min(7, r.rows); row++) {
    if (DAY_LABELS[row]) {
      ctx.fillText(DAY_LABELS[row], OX() - 6, OY() + row * STEP_PX + CELL / 2);
    }
  }
}

// The empty contribution grid is static during a run — classic/daily boards are
// always empty, and graph mode only *loses* cells as they're eaten — so we
// render it once to an offscreen canvas and blit it each frame instead of
// stroking hundreds of rounded rects every animation frame (a 36×22 board is
// ~800 cells). Graph mode then overlays just the remaining contribution cells.
function buildGridCache(r) {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const c = r.gridCanvas || (r.gridCanvas = document.createElement('canvas'));
  c.width = Math.round(r.w * dpr);
  c.height = Math.round(r.h * dpr);
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, r.w, r.h);
  const { theme } = r;
  for (let x = 0; x < r.cols; x++) {
    for (let y = 0; y < r.rows; y++) {
      const { px, py } = cellPx(x, y);
      g.fillStyle = theme.empty;
      roundedRect(g, px, py, CELL, CELL, 2);
      g.fill();
      g.strokeStyle = theme.emptyBorder;
      g.lineWidth = 0.5;
      roundedRect(g, px, py, CELL, CELL, 2);
      g.stroke();
    }
  }
  r.gridTheme = theme;
  r.gridCols = r.cols;
  r.gridRows = r.rows;
}

function ensureGridCache(r) {
  if (r.gridCanvas && r.gridTheme === r.theme &&
      r.gridCols === r.cols && r.gridRows === r.rows) return;
  buildGridCache(r);
}

function drawGrid(r, game) {
  ensureGridCache(r);
  const { ctx, theme } = r;
  ctx.drawImage(r.gridCanvas, 0, 0, r.w, r.h);
  // Graph mode: overlay the uneaten contribution cells, tinted by level.
  if (game.mode === 'graph' && game.cells) {
    for (const [key, lvl] of game.cells) {
      const comma = key.indexOf(',');
      const x = +key.slice(0, comma);
      const y = +key.slice(comma + 1);
      const { px, py } = cellPx(x, y);
      ctx.fillStyle = theme.levels[lvl - 1];
      roundedRect(ctx, px, py, CELL, CELL, 2);
      ctx.fill();
    }
  }
}

function drawFood(r, game) {
  if (game.mode === 'graph' || !game.food) return;
  const { ctx, theme } = r;
  r.foodPulse += 0.06;
  const pulseScale = r.reduceMotion ? 1 : 1 + Math.sin(r.foodPulse) * 0.15;
  const { px, py } = cellPx(game.food.x, game.food.y);
  const cx = px + CELL / 2;
  const cy = py + CELL / 2;
  ctx.save();
  ctx.shadowColor = theme.foodGlow;
  ctx.shadowBlur = r.reduceMotion ? 8 : 10 + Math.sin(r.foodPulse) * 4;
  const size = CELL * pulseScale;
  ctx.fillStyle = theme.food;
  roundedRect(ctx, cx - size / 2, cy - size / 2, size, size, 2);
  ctx.fill();
  ctx.restore();
}

// Timed bonus food: a gold cell that pulses faster than normal food and
// blinks through its final steps so the deadline is readable at a glance.
function drawGolden(r, game) {
  const g = game.golden;
  if (!g) return;
  const { ctx, theme } = r;
  // Blink over the last 15 steps (skip under reduced motion — steady is kinder).
  if (!r.reduceMotion && g.ttl <= 15 && g.ttl % 4 < 2) return;
  const pulseScale = r.reduceMotion ? 1 : 1 + Math.sin(r.foodPulse * 1.8) * 0.2;
  const { px, py } = cellPx(g.x, g.y);
  const cx = px + CELL / 2;
  const cy = py + CELL / 2;
  ctx.save();
  ctx.shadowColor = theme.goldGlow;
  ctx.shadowBlur = r.reduceMotion ? 10 : 12 + Math.sin(r.foodPulse * 1.8) * 5;
  const size = CELL * pulseScale;
  ctx.fillStyle = theme.gold;
  roundedRect(ctx, cx - size / 2, cy - size / 2, size, size, 3);
  ctx.fill();
  // A small sparkle so it reads as "bonus" even in a still frame.
  ctx.shadowBlur = 0;
  ctx.fillStyle = theme.bg;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 3);
  ctx.lineTo(cx + 2.2, cy);
  ctx.lineTo(cx, cy + 3);
  ctx.lineTo(cx - 2.2, cy);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function segmentColor(theme, index, total) {
  if (index === 0) return theme.head;
  const ratio = 1 - index / total;
  const lvl = Math.min(3, Math.floor(ratio * 4));
  return theme.levels[lvl];
}

// Interpolated pixel positions for each segment. prevSnake is the segment
// array captured just before the last step; alpha is progress into the
// current step (0..1). Each square slides one cell along the body path.
function segmentPositions(snake, prevSnake, alpha) {
  const out = [];
  for (let i = 0; i < snake.length; i++) {
    const to = snake[i];
    const from = prevSnake && prevSnake[i] ? prevSnake[i] : to;
    const { px: fx, py: fy } = cellPx(from.x, from.y);
    const { px: tx, py: ty } = cellPx(to.x, to.y);
    out.push({ x: fx + (tx - fx) * alpha, y: fy + (ty - fy) * alpha });
  }
  return out;
}

function drawSnakeBody(ctx, positions, colorAt) {
  // Connectors first (under the squares) so the body reads as one snake.
  ctx.lineCap = 'round';
  for (let i = 0; i < positions.length - 1; i++) {
    const a = positions[i];
    const b = positions[i + 1];
    ctx.strokeStyle = colorAt(i + 1);
    ctx.lineWidth = CELL - 4;
    ctx.beginPath();
    ctx.moveTo(a.x + CELL / 2, a.y + CELL / 2);
    ctx.lineTo(b.x + CELL / 2, b.y + CELL / 2);
    ctx.stroke();
  }
  for (let i = positions.length - 1; i >= 0; i--) {
    ctx.fillStyle = colorAt(i);
    roundedRect(ctx, positions[i].x, positions[i].y, CELL, CELL, 3);
    ctx.fill();
  }
}

// Rotten-commit hazard (unranked variant): a dark cell with an × through it,
// blinking through its final steps like the golden commit does.
function drawRotten(r, game) {
  const c = game.rotten;
  if (!c) return;
  const { ctx, theme } = r;
  if (!r.reduceMotion && c.ttl <= 15 && c.ttl % 4 < 2) return;
  const { px, py } = cellPx(c.x, c.y);
  ctx.save();
  ctx.fillStyle = theme.deathDark;
  roundedRect(ctx, px, py, CELL, CELL, 3);
  ctx.fill();
  ctx.strokeStyle = theme.death;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(px + 4, py + 4);
  ctx.lineTo(px + CELL - 4, py + CELL - 4);
  ctx.moveTo(px + CELL - 4, py + 4);
  ctx.lineTo(px + 4, py + CELL - 4);
  ctx.stroke();
  ctx.restore();
}

// Translucent replay opponent racing on the same board. In a crowd race the
// caller sets renderAlpha/showName per ghost each frame (nearest rival bright
// and named, the rest a quiet swarm); single-ghost modes use the defaults.
function drawGhost(r, ghost) {
  const { ctx, theme } = r;
  const g = ghost.game;
  if (!g.snake.length) return;
  const positions = segmentPositions(g.snake, ghost.prevSnake, ghost.alpha ?? 1);
  ctx.save();
  ctx.globalAlpha = ghost.renderAlpha ?? (g.alive && !g.won ? 0.3 : 0.12);
  drawSnakeBody(ctx, positions, (i) => segmentColor(theme, i, g.snake.length));
  if (ghost.showName ?? true) {
    ctx.globalAlpha = Math.min(0.7, ctx.globalAlpha * 2.2);
    ctx.font = '9px ' + FONT;
    ctx.fillStyle = theme.textMuted;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(ghost.name || 'ghost', positions[0].x + CELL / 2, positions[0].y - 2);
  }
  ctx.restore();
}

// --- "little guy" face (live player's snake only; ghosts stay faceless) ---

// The two eye boxes plus the travel-axis unit vectors, for a given head cell
// (board-space top-left px) and direction. Eyes sit near the leading edge,
// stacked perpendicular to travel, and always stay inside the head cell.
function eyeGeom(dir, head) {
  const near = CELL - EYE_LEAD - EYE; // leading-side coordinate
  const far = EYE_LEAD;
  const p1 = EYE_MARG;
  const p2 = EYE_MARG + EYE + EYE_GAP;
  let boxes, out, lat;
  if (dir === 1) {          // right
    boxes = [[near, p1], [near, p2]]; out = [1, 0]; lat = [0, 1];
  } else if (dir === 3) {   // left
    boxes = [[far, p1], [far, p2]];   out = [-1, 0]; lat = [0, 1];
  } else if (dir === 0) {   // up
    boxes = [[p1, far], [p2, far]];   out = [0, -1]; lat = [1, 0];
  } else {                  // down
    boxes = [[p1, near], [p2, near]]; out = [0, 1]; lat = [1, 0];
  }
  return {
    boxes: boxes.map(([x, y]) => ({ x: head.x + x, y: head.y + y })),
    out: { x: out[0], y: out[1] },
    lat: { x: lat[0], y: lat[1] },
  };
}

function cellCenterPx(cell) {
  const { px, py } = cellPx(cell.x, cell.y);
  return { x: px + CELL / 2, y: py + CELL / 2 };
}

// Pupils drift toward the current food (or golden, if it's the nearer target),
// clamped so they never leave the sclera. Centered when there's no target.
function pupilOffset(game, head) {
  let target = game.food || null;
  if (game.golden) {
    if (!target) target = game.golden;
    else {
      const hc = { x: head.x + CELL / 2, y: head.y + CELL / 2 };
      const df = distSq(hc, cellCenterPx(game.food));
      const dg = distSq(hc, cellCenterPx(game.golden));
      if (dg < df) target = game.golden;
    }
  }
  if (!target) return { x: 0, y: 0 };
  const hcx = head.x + CELL / 2;
  const hcy = head.y + CELL / 2;
  const tc = cellCenterPx(target);
  const dx = tc.x - hcx;
  const dy = tc.y - hcy;
  const len = Math.hypot(dx, dy) || 1;
  return { x: (dx / len) * PUPIL_TRACK, y: (dy / len) * PUPIL_TRACK };
}

function distSq(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

// True while a blink is showing; reschedules the next blink off the frame clock.
function faceBlinking(r) {
  if (r.reduceMotion) return false;
  if (r.faceClock < r.nextBlink) return false;
  if (r.faceClock >= r.nextBlink + BLINK_MS) {
    r.nextBlink = r.faceClock + BLINK_MIN + Math.random() * BLINK_VAR;
    return false;
  }
  return true;
}

function drawBeanEyes(r, geom, game, head) {
  const { ctx, theme } = r;
  const off = pupilOffset(game, head);
  for (const b of geom.boxes) {
    ctx.fillStyle = theme.eyeWhite;
    roundedRect(ctx, b.x, b.y, EYE, EYE, EYE_RX);
    ctx.fill();
    const cx = b.x + EYE / 2 + off.x;
    const cy = b.y + EYE / 2 + off.y;
    ctx.fillStyle = theme.eyes;
    roundedRect(ctx, cx - PUPIL / 2, cy - PUPIL / 2, PUPIL, PUPIL, 1);
    ctx.fill();
    ctx.fillStyle = theme.eyeWhite;
    ctx.fillRect(cx - PUPIL / 2 + 0.4, cy - PUPIL / 2 + 0.4, GLINT, GLINT);
  }
}

function drawBlink(r, geom) {
  const { ctx, theme } = r;
  ctx.fillStyle = theme.eyes;
  for (const b of geom.boxes) ctx.fillRect(b.x, b.y + EYE / 2 - 1, EYE, 2);
}

function drawNomFace(r, geom) {
  const { ctx, theme } = r;
  // Blush on the cheeks, just behind the eyes (toward the body).
  ctx.save();
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = theme.blush;
  for (const b of geom.boxes) {
    const cx = b.x + EYE / 2 - geom.out.x * (EYE / 2 + 3);
    const cy = b.y + EYE / 2 - geom.out.y * (EYE / 2 + 3);
    roundedRect(ctx, cx - BLUSH_W / 2, cy - BLUSH_H / 2, BLUSH_W, BLUSH_H, 2);
    ctx.fill();
  }
  ctx.restore();
  // Upward "^^" arcs for a happy squint.
  ctx.save();
  ctx.strokeStyle = theme.eyes;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const b of geom.boxes) {
    const cx = b.x + EYE / 2;
    const cy = b.y + EYE / 2;
    ctx.beginPath();
    ctx.moveTo(b.x + 0.5, cy + 1.5);
    ctx.quadraticCurveTo(cx, cy - 2.5, b.x + EYE - 0.5, cy + 1.5);
    ctx.stroke();
  }
  ctx.restore();
}

// Two dark X's where the bean eyes would be — drawn on the death flash.
function drawXEyes(r, geom) {
  const { ctx, theme } = r;
  ctx.save();
  ctx.strokeStyle = theme.eyes;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  for (const b of geom.boxes) {
    ctx.beginPath();
    ctx.moveTo(b.x + 0.5, b.y + 0.5);
    ctx.lineTo(b.x + EYE - 0.5, b.y + EYE - 0.5);
    ctx.moveTo(b.x + EYE - 0.5, b.y + 0.5);
    ctx.lineTo(b.x + 0.5, b.y + EYE - 0.5);
    ctx.stroke();
  }
  ctx.restore();
}

// A forked tongue (matching the header-logo glyph) flicks out of the leading
// edge every ~7s, poking out and retracting over ~300ms. Frame-clock timed.
function drawTongue(r, head, geom) {
  if (r.reduceMotion) return;
  if (r.faceClock < r.nextTongue) return;
  const t = (r.faceClock - r.nextTongue) / TONGUE_MS;
  if (t >= 1) {
    r.nextTongue = r.faceClock + TONGUE_INT + (Math.random() * 2 - 1) * TONGUE_VAR;
    return;
  }
  const ext = Math.sin(Math.PI * t); // out then back in
  const { ctx, theme } = r;
  const { out, lat } = geom;
  const mx = head.x + CELL / 2 + out.x * (CELL / 2);
  const my = head.y + CELL / 2 + out.y * (CELL / 2);
  const ex = mx + out.x * TONGUE_STEM * ext;
  const ey = my + out.y * TONGUE_STEM * ext;
  const px = out.x * TONGUE_PRONG * ext;
  const py = out.y * TONGUE_PRONG * ext;
  const lx = lat.x * TONGUE_SPREAD * ext;
  const ly = lat.y * TONGUE_SPREAD * ext;
  ctx.save();
  ctx.strokeStyle = theme.tongue;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(mx, my);
  ctx.lineTo(ex, ey);
  ctx.lineTo(ex + px + lx, ey + py + ly);
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex + px - lx, ey + py - ly);
  ctx.stroke();
  ctx.restore();
}

function drawFace(r, game, head, dir) {
  const geom = eyeGeom(dir, head);
  const blinking = faceBlinking(r); // evaluated every frame to keep the schedule moving
  if (r.nomTimer > 0) {
    drawNomFace(r, geom);
  } else if (blinking) {
    drawBlink(r, geom);
  } else {
    drawBeanEyes(r, geom, game, head);
  }
  // Tongue is independent of the eyes, but yields to the eating squint.
  if (r.nomTimer === 0) drawTongue(r, head, geom);
}

function drawSnake(r, game, prevSnake, alpha) {
  const { ctx, theme } = r;
  const isDying = r.deathFlashTimer > 0;
  const body = isDying && r.deathSnapshot ? r.deathSnapshot : game.snake;
  const positions = isDying
    ? body.map((s) => { const { px, py } = cellPx(s.x, s.y); return { x: px, y: py }; })
    : segmentPositions(body, prevSnake, alpha);

  const colorAt = (i) => {
    if (isDying) {
      const flash = r.reduceMotion ? true : Math.floor(r.deathFlashTimer / 4) % 2 === 0;
      return flash ? theme.death : theme.deathDark;
    }
    return segmentColor(theme, i, body.length);
  };

  drawSnakeBody(ctx, positions, colorAt);

  // Face on the head — X-eyes through the death flash, the full face otherwise.
  if (positions.length) {
    if (isDying) drawXEyes(r, eyeGeom(game.dir, positions[0]));
    else drawFace(r, game, positions[0], game.dir);
  }
}

function drawParticles(r) {
  const { ctx } = r;
  for (let i = r.particles.length - 1; i >= 0; i--) {
    const p = r.particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.08;
    p.life -= p.decay;
    if (p.life <= 0) { r.particles.splice(i, 1); continue; }
    ctx.globalAlpha = p.life;
    ctx.fillStyle = p.color;
    roundedRect(ctx, p.x - p.size / 2, p.y - p.size / 2, p.size, p.size, 1);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawFloatingTexts(r) {
  const { ctx, theme } = r;
  for (let i = r.floatingTexts.length - 1; i >= 0; i--) {
    const ft = r.floatingTexts[i];
    ft.y -= ft.big ? 0.5 : 0.8;
    ft.life -= ft.decay;
    if (ft.life <= 0) { r.floatingTexts.splice(i, 1); continue; }
    ctx.globalAlpha = ft.life;
    ctx.font = (ft.big ? 'bold 18px ' : 'bold 13px ') + FONT;
    ctx.fillStyle = theme.accent;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(ft.text, ft.x, ft.y);
  }
  ctx.globalAlpha = 1;
}

// Draining bar showing how many steps remain to keep the streak alive —
// makes the combo system legible instead of feeling random. Anchored to the
// visible viewport, not the (possibly wider) logical board.
function drawComboMeter(r, game, alpha) {
  if (!game.alive || game.won || game.streak === 0) return;
  const remaining = 1 - (game.stepsSinceFood + alpha) / STREAK_WINDOW;
  if (remaining <= 0) return;
  const { ctx, theme } = r;
  const w = 70;
  const x = (r.camera ? r.camera.viewW : r.w) - w - 10;
  const y = 6;
  // Clear the label strip behind the meter so month labels don't collide.
  ctx.fillStyle = theme.bg;
  ctx.fillRect(x - 66, 0, w + 76, LABEL_TOP - 2);
  ctx.font = '9px ' + FONT;
  ctx.fillStyle = theme.textMuted;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(`combo ×${game.multiplier}`, x - 6, y + 3);
  ctx.fillStyle = theme.empty;
  roundedRect(ctx, x, y, w, 6, 3);
  ctx.fill();
  ctx.fillStyle = remaining < 0.25 ? theme.death : theme.accent;
  roundedRect(ctx, x, y, Math.max(4, w * remaining), 6, 3);
  ctx.fill();
}

// Ease the camera toward the interpolated head; clamp to the board edges.
// x === null (fresh camera) snaps immediately so runs never open mid-pan.
function updateCamera(r, game, prevSnake, alpha) {
  const cam = r.camera;
  if (!cam || !game.snake.length) return;
  const to = game.snake[0];
  const from = prevSnake && prevSnake[0] ? prevSnake[0] : to;
  const hx = OX() + (from.x + (to.x - from.x) * alpha) * STEP_PX + CELL / 2;
  const desired = Math.max(0, Math.min(r.w - cam.viewW, hx - cam.viewW / 2));
  cam.x = cam.x == null ? desired : cam.x + (desired - cam.x) * 0.18;
}

export function draw(r, game, prevSnake, alpha, opts = {}) {
  const { monthLabels = null, ghost = null, ghosts = null, showCombo = false } = opts;
  const { ctx, theme } = r;
  const ghostList = ghosts || (ghost ? [ghost] : []);

  // Social-card framing (offscreen clip only): paint the full letterbox, draw
  // the injected chrome (brand + live stats), then shift into the centered,
  // scaled board space so everything below renders as usual. r.card is never
  // set for the on-screen renderer, so that path is unaffected.
  if (r.card) {
    const c = r.card;
    ctx.setTransform(c.dpr, 0, 0, c.dpr, 0, 0);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, c.width, c.height);
    if (c.chrome) c.chrome(ctx, game);
    ctx.setTransform(c.scale * c.dpr, 0, 0, c.scale * c.dpr, c.offX * c.dpr, c.offY * c.dpr);
  }

  ctx.save();

  // Renderer-local frame clock (ms) for blink/tongue timing. Clamped so a
  // backgrounded tab resuming doesn't fire a burst of face events.
  const nowTs = performance.now();
  if (!r.faceTs) r.faceTs = nowTs;
  r.faceClock += Math.min(100, nowTs - r.faceTs);
  r.faceTs = nowTs;

  if (r.shakeTimer > 0) {
    r.shakeTimer--;
    const mag = Math.min(4, r.shakeTimer * 0.5);
    ctx.translate((Math.random() - 0.5) * 2 * mag, (Math.random() - 0.5) * 2 * mag);
  }
  if (r.deathFlashTimer > 0) r.deathFlashTimer--;

  const viewW = r.camera ? r.camera.viewW : r.w;
  ctx.fillStyle = theme.bg;
  ctx.fillRect(-8, -8, viewW + 16, r.h + 16);

  updateCamera(r, game, prevSnake, alpha);

  // Board-space layer: pans with the camera.
  ctx.save();
  if (r.camera) ctx.translate(-r.camera.x, 0);
  drawMonthLabels(r, monthLabels);
  drawGrid(r, game);
  drawFood(r, game);
  drawGolden(r, game);
  drawRotten(r, game);
  for (const g of ghostList) drawGhost(r, g);
  drawSnake(r, game, prevSnake, alpha);
  if (r.nomTimer > 0) r.nomTimer--; // drain the eating-squint timer once per frame
  drawParticles(r);
  drawFloatingTexts(r);
  ctx.restore();

  // Pinned layer: fixed to the viewport.
  drawDayLabels(r);
  if (showCombo) drawComboMeter(r, game, alpha);

  ctx.restore();
}

export function effectsActive(r) {
  return r.particles.length > 0 || r.floatingTexts.length > 0 ||
    r.deathFlashTimer > 0 || r.shakeTimer > 0;
}

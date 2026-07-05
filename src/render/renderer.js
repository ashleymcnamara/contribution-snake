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
    theme: null,
    reduceMotion: false,
    // effects state
    particles: [],
    floatingTexts: [],
    foodPulse: 0,
    shakeTimer: 0,
    deathFlashTimer: 0,
    deathSnapshot: null,
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
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  r.canvas.width = Math.round(r.w * dpr);
  r.canvas.height = Math.round(r.h * dpr);
  r.canvas.style.width = r.w + 'px';
  r.canvas.style.height = r.h + 'px';
  r.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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

export function clearEffects(r) {
  r.particles = [];
  r.floatingTexts = [];
  r.deathFlashTimer = 0;
  r.deathSnapshot = null;
  r.shakeTimer = 0;
}

// --- drawing ---

function drawLabels(r, monthly) {
  const { ctx, theme } = r;
  ctx.font = '10px ' + FONT;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = theme.textMuted;
  ctx.textAlign = 'right';
  for (let row = 0; row < Math.min(7, r.rows); row++) {
    if (DAY_LABELS[row]) {
      ctx.fillText(DAY_LABELS[row], OX() - 6, OY() + row * STEP_PX + CELL / 2);
    }
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const labels = monthly || MONTH_LABELS;
  const colsPerLabel = Math.ceil(r.cols / labels.length);
  for (let m = 0; m < labels.length; m++) {
    const col = m * colsPerLabel;
    if (col < r.cols) ctx.fillText(labels[m], OX() + col * STEP_PX, 4);
  }
}

function drawGrid(r, game) {
  const { ctx, theme } = r;
  for (let x = 0; x < r.cols; x++) {
    for (let y = 0; y < r.rows; y++) {
      const { px, py } = cellPx(x, y);
      let fill = theme.empty;
      // Graph mode: uneaten contribution cells are food, tinted by level.
      if (game.mode === 'graph') {
        const lvl = game.cells.get(`${x},${y}`);
        if (lvl) fill = theme.levels[lvl - 1];
      }
      ctx.fillStyle = fill;
      roundedRect(ctx, px, py, CELL, CELL, 2);
      ctx.fill();
      if (fill === theme.empty) {
        ctx.strokeStyle = theme.emptyBorder;
        ctx.lineWidth = 0.5;
        roundedRect(ctx, px, py, CELL, CELL, 2);
        ctx.stroke();
      }
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

// Translucent replay opponent racing on the same board.
function drawGhost(r, ghost) {
  const { ctx, theme } = r;
  const g = ghost.game;
  if (!g.snake.length) return;
  const positions = segmentPositions(g.snake, ghost.prevSnake, ghost.alpha ?? 1);
  ctx.save();
  ctx.globalAlpha = g.alive && !g.won ? 0.3 : 0.12;
  drawSnakeBody(ctx, positions, (i) => segmentColor(theme, i, g.snake.length));
  ctx.globalAlpha = Math.min(0.7, ctx.globalAlpha * 2.2);
  ctx.font = '9px ' + FONT;
  ctx.fillStyle = theme.textMuted;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(ghost.name || 'ghost', positions[0].x + CELL / 2, positions[0].y - 2);
  ctx.restore();
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

  // Eyes on the head
  if (!isDying && positions.length) {
    const head = positions[0];
    const dir = game.dir;
    ctx.fillStyle = theme.eyes;
    const es = 3; // eye size
    const eo = 3; // offset from leading edge
    const hx = head.x;
    const hy = head.y;
    if (dir === 1) { // right
      ctx.fillRect(hx + CELL - eo - es, hy + 2, es, es);
      ctx.fillRect(hx + CELL - eo - es, hy + CELL - 2 - es, es, es);
    } else if (dir === 3) { // left
      ctx.fillRect(hx + eo, hy + 2, es, es);
      ctx.fillRect(hx + eo, hy + CELL - 2 - es, es, es);
    } else if (dir === 0) { // up
      ctx.fillRect(hx + 2, hy + eo, es, es);
      ctx.fillRect(hx + CELL - 2 - es, hy + eo, es, es);
    } else { // down
      ctx.fillRect(hx + 2, hy + CELL - eo - es, es, es);
      ctx.fillRect(hx + CELL - 2 - es, hy + CELL - eo - es, es, es);
    }
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
// makes the combo system legible instead of feeling random.
function drawComboMeter(r, game, alpha) {
  if (!game.alive || game.won || game.streak === 0) return;
  const remaining = 1 - (game.stepsSinceFood + alpha) / STREAK_WINDOW;
  if (remaining <= 0) return;
  const { ctx, theme } = r;
  const w = 70;
  const x = r.w - w - 10;
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

export function draw(r, game, prevSnake, alpha, opts = {}) {
  const { monthLabels = null, ghost = null, showCombo = false } = opts;
  const { ctx, theme } = r;
  ctx.save();

  if (r.shakeTimer > 0) {
    r.shakeTimer--;
    const mag = Math.min(4, r.shakeTimer * 0.5);
    ctx.translate((Math.random() - 0.5) * 2 * mag, (Math.random() - 0.5) * 2 * mag);
  }
  if (r.deathFlashTimer > 0) r.deathFlashTimer--;

  ctx.fillStyle = theme.bg;
  ctx.fillRect(-8, -8, r.w + 16, r.h + 16);

  drawLabels(r, monthLabels);
  drawGrid(r, game);
  drawFood(r, game);
  if (ghost) drawGhost(r, ghost);
  drawSnake(r, game, prevSnake, alpha);
  if (showCombo) drawComboMeter(r, game, alpha);
  drawParticles(r);
  drawFloatingTexts(r);

  ctx.restore();
}

export function effectsActive(r) {
  return r.particles.length > 0 || r.floatingTexts.length > 0 ||
    r.deathFlashTimer > 0 || r.shakeTimer > 0;
}

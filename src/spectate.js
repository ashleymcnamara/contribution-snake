// Spectate mode: play back a recorded run (from the server or localStorage) by
// re-simulating it in a fresh deterministic game. Because the core is
// deterministic, click-to-seek is just a re-run from step 0 to the target step.
// All shared game state lives on the ctx passed in by main; the only state this
// module owns is where to return to and who was last watched.
import { createGame, queueInput, step, boardSize } from './game/core.js';
import {
  resizeBoard, clearEffects, draw, spawnParticles, spawnFloatingText,
} from './render/renderer.js';
import { setTouchControls, hideOverlay, announce } from './ui.js';
import * as api from './api.js';

const $ = (id) => document.getElementById(id);

let spectReturn = 'leaderboard'; // 'leaderboard' | 'start' | 'share'
let lastWatched = null; // { name, score } when arriving via a share link

export function beginSpectate(ctx, data, { label, returnTo = 'leaderboard' } = {}) {
  // params rebuild the exact same game — used again by click-to-seek.
  const params = {
    mode: data.mode,
    seed: data.seed,
    graph: data.graph || null,
    wrap: data.wrap || false,
    speedFactor: data.speedFactor || 1,
    rotten: data.rotten || false,
    rules: data.rules || 1, // replay under the rules the run was recorded with
  };
  ctx.spect = { inputs: data.inputs, ptr: 0, name: data.name, score: data.score, params };
  spectReturn = returnTo;
  ctx.spectSpeed = 1;
  $('btn-spect-speed').textContent = '1×';
  $('spect-fill').style.width = '0%';
  ctx.mode = data.mode;
  ctx.session = null;
  ctx.ghosts = [];
  ctx.monthLabels = data.months || null;
  ctx.game = createGame(params);
  const { cols, rows } = boardSize(data.mode);
  if (ctx.renderer.cols !== cols || ctx.renderer.rows !== rows) resizeBoard(ctx.renderer, cols, rows);
  clearEffects(ctx.renderer);
  ctx.prevSnake = null;
  ctx.accumulator = 0;
  $('board-label').textContent = label;
  hideOverlay();
  setTouchControls(ctx, false);
  $('spectate-cta').hidden = false;
  ctx.state = 'spectating';
  ctx.updatePauseButton();
  announce(`Watching ${data.name}'s run.`);
  ctx.lastTime = performance.now();
  requestAnimationFrame((t) => spectateTick(ctx, t));
}

export async function startSpectate(ctx, replayId, { returnTo = 'leaderboard' } = {}) {
  try {
    const data = await api.getReplay(replayId);
    lastWatched = { name: data.name, score: data.score };
    if (returnTo === 'share') {
      ctx.sharedReplay = { id: replayId, name: data.name, score: data.score };
    } else {
      ctx.sharedReplay = null;
    }
    beginSpectate(ctx, data, {
      label: `Watching ${data.name} · ${data.score} pts — Esc or tap to exit`,
      returnTo,
    });
  } catch (err) {
    $('overlay-sub').textContent = `Couldn't load the replay: ${err.message}`;
  }
}

export function watchLocalBest(ctx) {
  const run = ctx.bestLocalRun();
  if (!run) return;
  lastWatched = null;
  beginSpectate(ctx, { ...run, name: 'you' }, {
    label: `Your best ${run.mode} run · ${run.score} pts — Esc or tap to exit`,
    returnTo: 'start',
  });
}

// Approximate playback progress: the last logged input's step index is a
// close stand-in for the run's length without pre-replaying the whole log.
function updateSpectProgress(ctx) {
  const inputs = ctx.spect.inputs;
  const lastStep = inputs.length ? inputs[inputs.length - 1].s : 0;
  $('spect-fill').style.width = lastStep
    ? `${Math.min(100, (ctx.game.stepCount / lastStep) * 100)}%`
    : '100%';
}

// Click-to-seek: the core is deterministic, so jumping to any point is just
// re-simulating from step 0 (milliseconds even for long runs) and resuming
// playback from there.
export function seekSpectate(ctx, fraction) {
  if (!ctx.spect) return;
  const inputs = ctx.spect.inputs;
  const lastStep = inputs.length ? inputs[inputs.length - 1].s : 0;
  const target = Math.max(0, Math.floor(fraction * lastStep));
  ctx.game = createGame(ctx.spect.params);
  ctx.spect.ptr = 0;
  while (ctx.game.alive && !ctx.game.won && ctx.game.stepCount < target) {
    while (ctx.spect.ptr < inputs.length && inputs[ctx.spect.ptr].s === ctx.game.stepCount) {
      queueInput(ctx.game, inputs[ctx.spect.ptr].d, false);
      ctx.spect.ptr++;
    }
    step(ctx.game);
  }
  ctx.prevSnake = null;
  ctx.accumulator = 0;
  clearEffects(ctx.renderer);
  updateSpectProgress(ctx);
  ctx.updateUI();
  draw(ctx.renderer, ctx.game, null, 1, { monthLabels: ctx.monthLabels });
  // Seeking back from the finished state resumes the playback loop.
  if (ctx.state === 'spectate-done' && ctx.game.alive && !ctx.game.won) {
    ctx.state = 'spectating';
    ctx.lastTime = performance.now();
    requestAnimationFrame((t) => spectateTick(ctx, t));
  }
}

function spectateTick(ctx, now) {
  if (ctx.state !== 'spectating') return;
  const dt = Math.min(250, now - ctx.lastTime);
  ctx.lastTime = now;
  ctx.accumulator += dt * ctx.spectSpeed;

  let steps = 0;
  const maxSteps = ctx.MAX_STEPS_PER_FRAME * ctx.spectSpeed;
  const spect = ctx.spect;
  while (ctx.accumulator >= ctx.game.speed && ctx.game.alive && !ctx.game.won && steps < maxSteps) {
    ctx.prevSnake = ctx.game.snake.map((s) => ({ ...s }));
    while (spect.ptr < spect.inputs.length && spect.inputs[spect.ptr].s === ctx.game.stepCount) {
      queueInput(ctx.game, spect.inputs[spect.ptr].d, false);
      spect.ptr++;
    }
    const ev = step(ctx.game);
    if (ev.ate) {
      spawnParticles(ctx.renderer, ev.head.x, ev.head.y, ctx.theme.food, 8);
      spawnFloatingText(ctx.renderer, ev.head.x, ev.head.y, `+${ev.points}`);
    }
    ctx.accumulator -= ctx.game.speed;
    steps++;
  }
  if (ctx.accumulator > ctx.game.speed) ctx.accumulator = ctx.game.speed;

  updateSpectProgress(ctx);

  if (!ctx.game.alive || ctx.game.won) {
    // Hold the final frame briefly, then return to the leaderboard.
    $('spect-fill').style.width = '100%';
    draw(ctx.renderer, ctx.game, null, 1, {});
    setTimeout(() => { if (ctx.state === 'spectate-done') exitSpectate(ctx); }, 900);
    ctx.state = 'spectate-done';
    return;
  }

  const alpha = Math.min(1, ctx.accumulator / ctx.game.speed);
  draw(ctx.renderer, ctx.game, ctx.prevSnake, alpha, { showCombo: true });
  requestAnimationFrame((t) => spectateTick(ctx, t));
}

// Land on the start menu after a shared run, keeping a one-tap "watch again"
// for the playback the viewer just enjoyed.
function showShareMenu(ctx) {
  ctx.showStartScreen();
  if (ctx.sharedReplay) {
    $('overlay-sub').textContent =
      `That was ${ctx.sharedReplay.name}'s ${ctx.sharedReplay.score}-point run. Your turn — pick a mode and beat it.`;
    const again = $('btn-watch-shared');
    again.textContent = `Watch ${ctx.sharedReplay.name}'s run again`;
    again.hidden = false;
  }
}

export function exitSpectate(ctx, { toMenu = false } = {}) {
  ctx.spect = null;
  ctx.state = 'idle';
  $('board-label').textContent = 'Snake graph';
  $('spectate-cta').hidden = true;
  // The on-screen "Play your own" button forces the menu; a shared run lands
  // there too, while leaderboard watchers go back to the standings.
  if (toMenu || spectReturn === 'share') {
    showShareMenu(ctx);
    return;
  }
  if (spectReturn === 'start') {
    ctx.showStartScreen();
    return;
  }
  ctx.showLeaderboardScreen();
  if (lastWatched) {
    $('overlay-sub').textContent =
      `That was ${lastWatched.name}'s ${lastWatched.score}-point run. Think you can beat it?`;
  }
}

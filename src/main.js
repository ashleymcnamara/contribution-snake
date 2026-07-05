import './style.css';
import { createGame, queueInput, step, boardSize } from './game/core.js';
import { botSteer } from './game/bot.js';
import { randomSeed } from './game/rng.js';
import {
  createRenderer, resizeBoard, fitBoard, draw, spawnParticles, spawnFloatingText,
  startDeathEffect, clearEffects, effectsActive,
} from './render/renderer.js';
import { loadThemeName, loadPalette, applyTheme } from './theme.js';
import * as audio from './audio.js';
import * as api from './api.js';
import {
  buildShareCard, downloadCard, shareText, gameUrl, shareLinks, nativeShare,
} from './share.js';
import { icons } from './icons.js';
import { ACHIEVEMENTS, loadUnlocked, evaluate as evaluateAchievements } from './achievements.js';

const $ = (id) => document.getElementById(id);

const canvas = $('game');
const renderer = createRenderer(canvas);

let themeName = loadThemeName();
let palette = loadPalette();
let theme = applyTheme(themeName, palette);
renderer.theme = theme;

// --- app state ---
let state = 'idle'; // idle | loading | playing | paused | dying | over | spectating
let mode = 'classic'; // classic | daily | graph
let game = null;
let prevSnake = null;
let session = null; // { sessionId, seed, day }
let graphData = null; // { username, grid, months, total }
let monthLabels = null;
let lastTime = 0;
let accumulator = 0;
let serverOk = false;
let submitted = false;
let lastRank = null;
let lastReplayId = null;
let lastWatched = null; // { name, score } when arriving via a share link
let sharedReplay = null; // { id, name, score } for the "watch again" button
// Translucent replay opponent racing on the daily board:
// { game, inputs, ptr, acc, prevSnake, alpha, name }
let ghost = null;
// Spectate mode playback: { inputs, ptr, name, score }
let spect = null;

const MODE_LABELS = { classic: 'Classic', daily: 'Daily challenge', graph: 'Your graph' };

function highScoreKey() { return `gh-snake-high-${mode}`; }
function getHighScore() { return parseInt(localStorage.getItem(highScoreKey()) || '0'); }

// --- lifetime local stats ---
const STATS_KEY = 'gh-snake-stats';

function loadStats() {
  return {
    games: 0, totalScore: 0, bestScore: 0, bestStreak: 0,
    dailiesPlayed: 0, dailyStreak: 0, lastDailyDay: null,
    ...JSON.parse(localStorage.getItem(STATS_KEY) || '{}'),
  };
}

function recordStats() {
  const s = loadStats();
  s.games++;
  s.totalScore += game.score;
  s.bestScore = Math.max(s.bestScore, game.score);
  s.bestStreak = Math.max(s.bestStreak, game.bestStreak);
  if (mode === 'daily' && session?.day && s.lastDailyDay !== session.day) {
    s.dailiesPlayed++;
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    s.dailyStreak = s.lastDailyDay === yesterday ? s.dailyStreak + 1 : 1;
    s.lastDailyDay = session.day;
  }
  localStorage.setItem(STATS_KEY, JSON.stringify(s));
}

// --- variant toggles (unranked) ---
function getVariants() {
  return {
    wrap: localStorage.getItem('gh-snake-var-wrap') === '1',
    chill: localStorage.getItem('gh-snake-var-chill') === '1',
  };
}

function variantsActiveFor(m) {
  const v = getVariants();
  return (v.wrap || v.chill) && m !== 'daily';
}

function updateVariantNote() {
  const v = getVariants();
  $('var-wrap').checked = v.wrap;
  $('var-chill').checked = v.chill;
  $('variant-note').hidden = !(v.wrap || v.chill);
}

function updateUI() {
  $('score').textContent = game ? game.score : 0;
  const streak = game ? game.streak : 0;
  $('streak').textContent = game && game.multiplier > 1 ? `${streak} ×${game.multiplier}` : String(streak);
  $('level').textContent = game ? game.level : 1;
  $('best').textContent = getHighScore();
}

function announce(msg) {
  $('a11y-status').textContent = msg;
}

// Short vibration on supported touch devices. Patterns are deliberately tiny so
// frequent events (eating) stay pleasant rather than buzzy.
function haptic(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

// Transient corner toast (used for achievement unlocks). Also mirrored to the
// screen-reader live region by the caller via announce().
function toast(icon, title, sub) {
  const stack = $('toast-stack');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML =
    `<span class="toast-icon" aria-hidden="true">${icon}</span>` +
    `<span class="toast-text"><strong>${escapeHtml(title)}</strong>` +
    (sub ? `<span>${escapeHtml(sub)}</span>` : '') + `</span>`;
  stack.appendChild(el);
  // Trigger the enter transition on the next frame.
  requestAnimationFrame(() => el.classList.add('show'));
  const remove = () => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  };
  setTimeout(remove, 4200);
  el.addEventListener('click', remove);
}

function updatePauseButton() {
  const btn = $('pause-btn');
  const active = state === 'playing' || state === 'paused';
  btn.disabled = !active;
  btn.innerHTML = state === 'paused' ? icons.play : icons.pause;
  btn.setAttribute('aria-label', state === 'paused' ? 'Resume' : 'Pause');
}

// --- overlay management ---
const OVERLAY_SECTIONS = ['mode-buttons', 'user-row', 'btn-leaderboard', 'btn-watch-shared',
  'btn-watch-best', 'btn-stats', 'btn-achievements', 'stats-panel', 'stats-back',
  'achievements-panel', 'achievements-back', 'btn-resume', 'submit-row',
  'over-actions', 'share-row', 'lb-tabs', 'leaderboard', 'over-stats'];

function showOverlay(title, sub, sections = []) {
  clearCountdown(); // cancel any pending resume countdown if we navigate away
  $('overlay-title').textContent = title;
  $('overlay-sub').textContent = sub;
  for (const id of OVERLAY_SECTIONS) $(id).hidden = !sections.includes(id);
  $('overlay').style.display = 'flex';
  // The touch d-pad is only useful during active play — keep it out of the way
  // (and out of the layout, so the board can reclaim the space) on every menu,
  // game-over, leaderboard and pause screen.
  setTouchControls(false);
  // Move focus with the content so keyboard / screen-reader users aren't
  // stranded on a control that just became hidden (focus would fall to <body>
  // and reading position would jump back to the top of the page).
  $('overlay-title').focus({ preventScroll: true });
}

function hideOverlay() {
  $('overlay').style.display = 'none';
}

// Show/hide the on-screen d-pad and re-fit the board to the space that leaves.
// It stays hidden on non-touch devices via the (pointer: coarse) media query.
function setTouchControls(show) {
  $('touch-controls').hidden = !show;
  if (renderer.cols) fitBoard(renderer);
}

// --- attract mode: a bot plays behind the start overlay ---
let demo = null;

function startDemo() {
  if (demo || renderer.reduceMotion) return;
  const { cols, rows } = boardSize('classic');
  if (renderer.cols !== cols || renderer.rows !== rows) resizeBoard(renderer, cols, rows);
  clearEffects(renderer);
  demo = {
    game: createGame({ mode: 'classic', seed: randomSeed() }),
    prevSnake: null,
    acc: 0,
    last: performance.now(),
    cooldown: 0,
  };
  requestAnimationFrame(demoTick);
}

function demoTick(now) {
  if (!demo || state !== 'idle') { demo = null; return; }
  const dt = Math.min(250, now - demo.last);
  demo.last = now;

  const g = demo.game;
  if (!g.alive || g.won) {
    // Linger on the death frame briefly, then restart with a fresh seed.
    demo.cooldown += dt;
    if (demo.cooldown > 1200) {
      demo.game = createGame({ mode: 'classic', seed: randomSeed() });
      demo.prevSnake = null;
      demo.acc = 0;
      demo.cooldown = 0;
      clearEffects(renderer);
    }
  } else {
    demo.acc += dt;
    while (demo.acc >= g.speed && g.alive && !g.won) {
      demo.prevSnake = g.snake.map((s) => ({ ...s }));
      botSteer(g);
      const ev = step(g);
      if (ev.ate) {
        spawnParticles(renderer, ev.head.x, ev.head.y, theme.food, 6);
        spawnFloatingText(renderer, ev.head.x, ev.head.y, `+${ev.points}`);
      }
      if (ev.died) startDeathEffect(renderer, g.snake);
      demo.acc -= g.speed;
    }
  }

  const alpha = g.alive ? Math.min(1, demo.acc / g.speed) : 1;
  draw(renderer, g, demo.prevSnake, alpha, {});
  requestAnimationFrame(demoTick);
}

function bestLocalRun() {
  let best = null;
  for (const m of ['classic', 'daily', 'graph']) {
    const r = JSON.parse(localStorage.getItem(`gh-snake-bestrun-${m}`) || 'null');
    if (r && (!best || r.score > best.score)) best = r;
  }
  return best;
}

function showStartScreen() {
  state = 'idle';
  updatePauseButton();
  const best = getHighScore();
  const localBest = bestLocalRun();
  const stats = loadStats();
  showOverlay(
    'Contribution Snake',
    best > 0 ? `Eat commits. Grow your streak. Best: ${best}.` : 'Eat commits. Grow your streak.',
    ['mode-buttons', ...(serverOk ? ['btn-leaderboard'] : []),
      ...(localBest ? ['btn-watch-best'] : []),
      ...(stats.games > 0 ? ['btn-stats', 'btn-achievements'] : [])]
  );
  if (localBest) {
    $('btn-watch-best').textContent = `Watch your best run (${localBest.score} pts)`;
  }
  updateVariantNote();
  startDemo();
  $('mode-note').hidden = serverOk;
  if (!serverOk) {
    $('mode-note').textContent = 'Server offline — classic mode only.';
    $('btn-daily').disabled = true;
    $('btn-graph').disabled = true;
  } else {
    $('btn-daily').disabled = false;
    $('btn-graph').disabled = false;
  }
  updateDailyNote();
}

// Clicking the logo returns to the start menu from any state (playing, spectating,
// death animation) and normalizes the URL so a later refresh also lands home.
function goHome(e) {
  if (e) {
    // Let cmd/ctrl/shift/middle-click open a fresh instance in a new tab.
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
  }
  const base = import.meta.env.BASE_URL || '/';
  if (location.pathname !== base || location.search) {
    history.replaceState(null, '', base);
  }
  showStartScreen();
}

// Countdown to the next daily board + today's result badge.
function updateDailyNote() {
  const el = $('daily-note');
  if (!serverOk) { el.hidden = true; return; }
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  const msLeft = next - now;
  const h = Math.floor(msLeft / 3600000);
  const m = Math.floor((msLeft % 3600000) / 60000);
  const s = Math.floor((msLeft % 60000) / 1000);
  const countdown = h > 0 ? `${h}h ${m}m` : `${m}m ${String(s).padStart(2, '0')}s`;
  const played = JSON.parse(localStorage.getItem(`gh-snake-daily-${day}`) || 'null');
  let badge = '';
  if (played) {
    const score = Number(played.score) || 0;
    const rank = Number(played.rank) || 0;
    badge = ` · <span class="daily-done">${icons.check}</span> ${score} pts${rank ? ` (#${rank})` : ''}`;
  }
  el.innerHTML = `New board in ${countdown}${badge}`;
  el.hidden = false;
}

setInterval(() => {
  if (state === 'idle' && !$('daily-note').hidden) updateDailyNote();
}, 1000);

// --- game lifecycle ---
async function startRun(selectedMode) {
  if (state === 'loading') return;
  mode = selectedMode;
  session = null;
  submitted = false;
  lastRank = null;
  lastReplayId = null;
  sharedReplay = null;
  ghost = null;
  spect = null;
  monthLabels = mode === 'graph' ? graphData.months : null;

  // Variant runs (wrap walls / chill speed) are unranked: no session is
  // created, so there is nothing to submit — fairness enforced by absence.
  const variants = variantsActiveFor(mode) ? getVariants() : { wrap: false, chill: false };
  const useVariants = variants.wrap || variants.chill;

  let seed = randomSeed();
  if (serverOk && !useVariants && (mode === 'classic' || mode === 'daily')) {
    state = 'loading';
    try {
      session = await api.createSession(mode);
      seed = session.seed;
    } catch (err) {
      session = null;
      if (mode === 'daily') {
        state = 'idle';
        showStartScreen();
        $('overlay-sub').textContent = `Couldn't start the daily challenge: ${err.message}`;
        return;
      }
    }
    // Daily: race today's #1 as a translucent ghost (same seed, same board).
    if (mode === 'daily' && session) {
      try {
        const { entries } = await api.getLeaderboard('daily', session.day);
        const top = entries.find((e) => e.replayId);
        if (top) {
          const replayData = await api.getReplay(top.replayId);
          ghost = {
            game: createGame({ mode: 'daily', seed: session.seed }),
            inputs: replayData.inputs,
            ptr: 0,
            acc: 0,
            prevSnake: null,
            alpha: 1,
            name: replayData.name,
          };
        }
      } catch {
        ghost = null; // racing is a bonus, never a blocker
      }
    }
  }

  game = createGame({
    mode,
    seed,
    graph: mode === 'graph' ? graphData.grid : null,
    wrap: variants.wrap,
    speedFactor: variants.chill ? 1.5 : 1,
  });
  const { cols, rows } = boardSize(mode);
  if (renderer.cols !== cols || renderer.rows !== rows) resizeBoard(renderer, cols, rows);
  clearEffects(renderer);
  prevSnake = null;
  accumulator = 0;

  const variantTag = useVariants
    ? ` · ${[variants.wrap && 'wrap', variants.chill && 'chill'].filter(Boolean).join(' + ')} (unranked)`
    : '';
  $('board-label').textContent = (
    mode === 'graph' ? `@${graphData.username} · last 12 months`
      : mode === 'daily' ? `Daily challenge · ${session.day}`
        : 'Snake graph') + variantTag;

  hideOverlay();
  state = 'playing';
  setTouchControls(true);
  updatePauseButton();
  updateUI();
  announce(`${MODE_LABELS[mode]} started.`);
  lastTime = performance.now();
  requestAnimationFrame(tick);
}

function handleStepEvents(ev) {
  if (ev.ate) {
    spawnParticles(renderer, ev.head.x, ev.head.y, theme.food, 8);
    spawnFloatingText(renderer, ev.head.x, ev.head.y, `+${ev.points}`);
    audio.playEat(game.streak);
    haptic(6);
    if (ev.levelUp) {
      spawnFloatingText(renderer, ev.head.x, ev.head.y, `LEVEL ${game.level}`, true);
      audio.playLevelUp();
      haptic([0, 18, 40, 18]);
      announce(`Level ${game.level}`);
    }
    updateUI();
  }
  if (ev.won) {
    audio.playWin();
    haptic([0, 40, 60, 40, 60, 80]);
    finishRun(true);
  } else if (ev.died) {
    audio.playDeath();
    haptic([0, 90, 40, 90]);
    startDeathEffect(renderer, game.snake);
    state = 'dying';
    requestAnimationFrame(dyingTick);
  }
}

function advanceGhost(dt) {
  const g = ghost.game;
  if (!g.alive || g.won) return;
  ghost.acc += dt;
  while (ghost.acc >= g.speed && g.alive && !g.won) {
    ghost.prevSnake = g.snake.map((s) => ({ ...s }));
    while (ghost.ptr < ghost.inputs.length && ghost.inputs[ghost.ptr].s === g.stepCount) {
      queueInput(g, ghost.inputs[ghost.ptr].d, false);
      ghost.ptr++;
    }
    step(g);
    ghost.acc -= g.speed;
  }
  ghost.alpha = Math.min(1, ghost.acc / g.speed);
}

function tick(now) {
  if (state !== 'playing') return;
  const dt = Math.min(250, now - lastTime);
  lastTime = now;
  accumulator += dt;

  if (ghost) advanceGhost(dt);

  while (accumulator >= game.speed) {
    prevSnake = game.snake.map((s) => ({ ...s }));
    const ev = step(game);
    handleStepEvents(ev);
    if (state !== 'playing') return;
    accumulator -= game.speed;
  }

  const alpha = Math.min(1, accumulator / game.speed);
  draw(renderer, game, prevSnake, alpha, { monthLabels, ghost, showCombo: true });
  requestAnimationFrame(tick);
}

function dyingTick() {
  if (renderer.deathFlashTimer <= 0 && !effectsActive(renderer)) {
    finishRun(false);
    return;
  }
  draw(renderer, game, null, 1, { monthLabels, ghost });
  requestAnimationFrame(dyingTick);
}

// --- spectate mode: play back a run (from the server or localStorage) ---
let spectReturn = 'leaderboard';

function beginSpectate(data, { label, returnTo = 'leaderboard' } = {}) {
  spect = { inputs: data.inputs, ptr: 0, name: data.name, score: data.score };
  spectReturn = returnTo;
  mode = data.mode;
  session = null;
  ghost = null;
  monthLabels = data.months || null;
  game = createGame({
    mode: data.mode,
    seed: data.seed,
    graph: data.graph || null,
    wrap: data.wrap || false,
    speedFactor: data.speedFactor || 1,
  });
  const { cols, rows } = boardSize(data.mode);
  if (renderer.cols !== cols || renderer.rows !== rows) resizeBoard(renderer, cols, rows);
  clearEffects(renderer);
  prevSnake = null;
  accumulator = 0;
  $('board-label').textContent = label;
  hideOverlay();
  setTouchControls(false);
  $('spectate-cta').hidden = false;
  state = 'spectating';
  updatePauseButton();
  announce(`Watching ${data.name}'s run.`);
  lastTime = performance.now();
  requestAnimationFrame(spectateTick);
}

async function startSpectate(replayId, { returnTo = 'leaderboard' } = {}) {
  try {
    const data = await api.getReplay(replayId);
    lastWatched = { name: data.name, score: data.score };
    if (returnTo === 'share') {
      sharedReplay = { id: replayId, name: data.name, score: data.score };
    } else {
      sharedReplay = null;
    }
    beginSpectate(data, {
      label: `Watching ${data.name} · ${data.score} pts — Esc or tap to exit`,
      returnTo,
    });
  } catch (err) {
    $('overlay-sub').textContent = `Couldn't load the replay: ${err.message}`;
  }
}

function watchLocalBest() {
  const run = bestLocalRun();
  if (!run) return;
  lastWatched = null;
  beginSpectate({ ...run, name: 'you' }, {
    label: `Your best ${run.mode} run · ${run.score} pts — Esc or tap to exit`,
    returnTo: 'start',
  });
}

function spectateTick(now) {
  if (state !== 'spectating') return;
  const dt = Math.min(250, now - lastTime);
  lastTime = now;
  accumulator += dt;

  while (accumulator >= game.speed && game.alive && !game.won) {
    prevSnake = game.snake.map((s) => ({ ...s }));
    while (spect.ptr < spect.inputs.length && spect.inputs[spect.ptr].s === game.stepCount) {
      queueInput(game, spect.inputs[spect.ptr].d, false);
      spect.ptr++;
    }
    const ev = step(game);
    if (ev.ate) {
      spawnParticles(renderer, ev.head.x, ev.head.y, theme.food, 8);
      spawnFloatingText(renderer, ev.head.x, ev.head.y, `+${ev.points}`);
    }
    accumulator -= game.speed;
  }

  if (!game.alive || game.won) {
    // Hold the final frame briefly, then return to the leaderboard.
    draw(renderer, game, null, 1, {});
    setTimeout(() => { if (state === 'spectating') exitSpectate(); }, 900);
    state = 'spectate-done';
    return;
  }

  const alpha = Math.min(1, accumulator / game.speed);
  draw(renderer, game, prevSnake, alpha, { showCombo: true });
  requestAnimationFrame(spectateTick);
}

// Land on the start menu after a shared run, keeping a one-tap "watch again"
// for the playback the viewer just enjoyed.
function showShareMenu() {
  showStartScreen();
  if (sharedReplay) {
    $('overlay-sub').textContent =
      `That was ${sharedReplay.name}'s ${sharedReplay.score}-point run. Your turn — pick a mode and beat it.`;
    const again = $('btn-watch-shared');
    again.textContent = `Watch ${sharedReplay.name}'s run again`;
    again.hidden = false;
  }
}

function exitSpectate({ toMenu = false } = {}) {
  spect = null;
  state = 'idle';
  $('board-label').textContent = 'Snake graph';
  $('spectate-cta').hidden = true;
  // The on-screen "Play your own" button forces the menu; a shared run lands
  // there too, while leaderboard watchers go back to the standings.
  if (toMenu || spectReturn === 'share') {
    showShareMenu();
    return;
  }
  if (spectReturn === 'start') {
    showStartScreen();
    return;
  }
  showLeaderboardScreen();
  if (lastWatched) {
    $('overlay-sub').textContent =
      `That was ${lastWatched.name}'s ${lastWatched.score}-point run. Think you can beat it?`;
  }
}

function finishRun(won) {
  state = 'over';
  updatePauseButton();
  const best = Math.max(getHighScore(), game.score);
  localStorage.setItem(highScoreKey(), String(best));
  updateUI();

  recordStats();

  // Unlock achievements from the freshly-updated lifetime stats plus this run.
  const variant = !!(game.wrap || (game.speedFactor && game.speedFactor !== 1));
  const unlocked = evaluateAchievements({
    stats: loadStats(),
    run: { score: game.score, bestStreak: game.bestStreak, won, mode, variant },
  });
  for (const a of unlocked) toast(a.icon, `${a.name} unlocked`, a.desc);

  // Keep your best run per mode locally so it can be re-watched anytime.
  if (game.stepCount > 0) {
    const runKey = `gh-snake-bestrun-${mode}`;
    const prevRun = JSON.parse(localStorage.getItem(runKey) || 'null');
    if (!prevRun || game.score > prevRun.score) {
      localStorage.setItem(runKey, JSON.stringify({
        mode,
        seed: game.seed,
        inputs: game.inputLog,
        score: game.score,
        wrap: game.wrap || undefined,
        speedFactor: game.speedFactor !== 1 ? game.speedFactor : undefined,
        graph: mode === 'graph' ? graphData.grid : undefined,
        months: mode === 'graph' ? graphData.months : undefined,
      }));
    }
  }

  // Remember today's daily result for the start-screen badge.
  if (mode === 'daily' && session?.day) {
    const key = `gh-snake-daily-${session.day}`;
    const prev = JSON.parse(localStorage.getItem(key) || 'null');
    if (!prev || game.score > prev.score) {
      localStorage.setItem(key, JSON.stringify({ score: game.score, rank: null }));
    }
  }

  const eaten = game.totalCells ? game.totalCells - game.cells.size : 0;
  const statsHtml =
    mode === 'graph'
      ? `<strong>${game.score}</strong> points · ate <strong>${eaten}</strong>/${game.totalCells} days<br>
         Best streak: <strong>${game.bestStreak}</strong> · Best score: <strong>${best}</strong>`
      : `<strong>${game.score}</strong> contributions · <strong>${game.bestStreak}</strong> best streak<br>
         Best: <strong>${best}</strong> contributions`;

  const canSubmit = !!session && serverOk;
  showOverlay(
    won ? 'You ate the whole year!' : 'Game Over',
    won ? 'Every contribution devoured.' : mode === 'daily' ? `Daily challenge · ${session?.day || ''}` : 'Don’t break the build.',
    ['over-stats', 'over-actions', 'share-row', ...(canSubmit ? ['submit-row'] : [])]
  );
  $('share-native').hidden = !navigator.share;
  $('over-stats').innerHTML = statsHtml;
  if (canSubmit) {
    $('name-input').value = localStorage.getItem('gh-snake-name') || '';
    $('btn-submit').disabled = false;
    $('btn-submit').textContent = 'Submit score';
  }
  const unlockedMsg = unlocked.length
    ? ` Achievement${unlocked.length > 1 ? 's' : ''} unlocked: ${unlocked.map((a) => a.name).join(', ')}.`
    : '';
  announce(`Game over. ${game.score} points, best streak ${game.bestStreak}.${unlockedMsg}`);
}

// --- pause / resume ---
function pauseGame() {
  if (state !== 'playing') return;
  state = 'paused';
  updatePauseButton();
  showOverlay('Paused', 'Take a break. Your streak will wait.', ['btn-resume']);
}

function resumeGame() {
  if (state !== 'paused') return;
  hideOverlay();
  state = 'resuming';
  setTouchControls(true);
  updatePauseButton();
  // A brief 3-2-1 so you're never dropped straight back into a moving snake
  // after a pause or a tab switch. Redraw the frozen board underneath each beat.
  runCountdown(() => {
    if (state !== 'resuming') return; // aborted (e.g. went home)
    state = 'playing';
    updatePauseButton();
    lastTime = performance.now();
    accumulator = 0;
    requestAnimationFrame(tick);
  });
}

let countdownTimers = [];
function clearCountdown() {
  countdownTimers.forEach(clearTimeout);
  countdownTimers = [];
  $('countdown').hidden = true;
}

function runCountdown(done) {
  clearCountdown();
  const el = $('countdown');
  const steps = ['3', '2', '1'];
  el.hidden = false;
  const show = (i) => {
    if (i >= steps.length) {
      clearCountdown();
      done();
      return;
    }
    el.textContent = steps[i];
    el.classList.remove('tick');
    void el.offsetWidth; // restart the CSS pop animation
    el.classList.add('tick');
    audio.playClick();
    if (game) draw(renderer, game, null, 1, { monthLabels, ghost });
    countdownTimers.push(setTimeout(() => show(i + 1), 500));
  };
  show(0);
}

function togglePause() {
  if (state === 'playing') pauseGame();
  else if (state === 'paused') resumeGame();
}

// --- leaderboard ---
async function renderLeaderboard(lbMode, dayOverride) {
  const el = $('leaderboard');
  el.hidden = false;
  el.innerHTML = '<div class="lb-empty">Loading…</div>';
  try {
    const day = lbMode === 'daily'
      ? (dayOverride || new Date().toISOString().slice(0, 10))
      : undefined;
    const { entries, day: actualDay } = await api.getLeaderboard(lbMode, day);
    if (!entries.length) {
      el.innerHTML = `<div class="lb-empty">No scores yet${lbMode === 'daily' ? ' today' : ''}. Be the first!</div>`;
      return;
    }
    const myName = localStorage.getItem('gh-snake-name');
    el.innerHTML = entries.map((e, i) => `
      <div class="lb-row${e.name === myName ? ' me' : ''}${e.replayId ? ' watchable' : ''}"
           ${e.replayId ? `data-replay="${escapeHtml(e.replayId)}" role="button" tabindex="0" title="Watch this run"` : ''}>
        <span class="lb-rank">${i + 1}</span>
        <span class="lb-name">${escapeHtml(e.name)}</span>
        <span class="lb-score">${e.score}</span>
        ${e.replayId ? `<span class="lb-watch" aria-hidden="true">${icons.play}</span>` : ''}
      </div>`).join('');
    if (lbMode === 'daily' && actualDay) {
      el.insertAdjacentHTML('afterbegin', `<div class="lb-empty">Daily · ${actualDay}</div>`);
    }
  } catch (err) {
    el.innerHTML = `<div class="lb-empty">Couldn't load leaderboard: ${escapeHtml(err.message)}</div>`;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function setActiveTab(activeId) {
  for (const id of ['lb-tab-classic', 'lb-tab-daily', 'lb-tab-yesterday']) {
    const btn = $(id);
    const on = id === activeId;
    btn.classList.toggle('active', on);
    if (on) btn.setAttribute('aria-current', 'true');
    else btn.removeAttribute('aria-current');
  }
}

function showLeaderboardScreen() {
  showOverlay('Leaderboard', 'Server-verified scores.', ['lb-tabs', 'leaderboard']);
  setActiveTab('lb-tab-classic');
  renderLeaderboard('classic');
}

function showStatsScreen() {
  const s = loadStats();
  const avg = s.games ? Math.round(s.totalScore / s.games) : 0;
  const blocks = [
    [s.games, 'games played'],
    [s.bestScore, 'best score'],
    [avg, 'average score'],
    [s.bestStreak, 'best streak'],
    [s.dailiesPlayed, 'dailies played'],
    [s.dailyStreak, 'daily streak'],
  ];
  $('stats-panel').innerHTML = blocks.map(([n, label]) => `
    <div class="stat-block">
      <div class="stat-number">${n}</div>
      <div class="stat-name">${label}</div>
    </div>`).join('');
  showOverlay('Your stats', 'Stored locally in this browser.', ['stats-panel', 'stats-back']);
}

function showAchievementsScreen() {
  const unlocked = loadUnlocked();
  $('achievements-panel').innerHTML = ACHIEVEMENTS.map((a) => {
    const got = unlocked.has(a.id);
    return `<div class="achv ${got ? 'unlocked' : 'locked'}">
      <div class="achv-badge" aria-hidden="true">${a.icon}</div>
      <div class="achv-text">
        <div class="achv-name">${escapeHtml(a.name)}</div>
        <div class="achv-desc">${escapeHtml(a.desc)}</div>
      </div>
      ${got ? `<span class="achv-check" aria-hidden="true">${icons.check}</span>` : ''}
    </div>`;
  }).join('');
  showOverlay('Achievements', `${unlocked.size} of ${ACHIEVEMENTS.length} unlocked`,
    ['achievements-panel', 'achievements-back']);
}

// --- graph mode ---
async function startGraphRun() {
  const username = $('username-input').value.trim();
  if (!username) return;
  $('overlay-sub').textContent = `Fetching @${username}'s contributions…`;
  state = 'loading';
  try {
    graphData = await api.getContributions(username);
    localStorage.setItem('gh-snake-user', username);
    state = 'idle';
    if (!graphData.grid.flat().some((l) => l > 0)) {
      $('overlay-sub').textContent = `@${username} has no contributions in the last year. Nothing to eat!`;
      return;
    }
    await startRun('graph');
  } catch (err) {
    state = 'idle';
    $('overlay-sub').textContent = `Couldn't fetch @${username}: ${err.message}`;
  }
}

// --- score submission ---
async function handleSubmit() {
  const name = $('name-input').value.trim() || 'anonymous';
  localStorage.setItem('gh-snake-name', name);
  const btn = $('btn-submit');
  btn.disabled = true;
  btn.textContent = 'Verifying…';
  try {
    const result = await api.submitScore(session.sessionId, name, game.inputLog);
    submitted = true;
    lastRank = result.rank;
    lastReplayId = result.replayId;
    if (mode === 'daily' && session?.day) {
      localStorage.setItem(`gh-snake-daily-${session.day}`,
        JSON.stringify({ score: result.score, rank: result.rank }));
    }
    $('submit-row').hidden = true;
    $('overlay-sub').textContent = `Verified! You're #${result.rank} ${mode === 'daily' ? 'today' : 'all-time'}.`;
    $('leaderboard').hidden = false;
    renderLeaderboard(mode === 'daily' ? 'daily' : 'classic');
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Submit score';
    $('overlay-sub').textContent = `Submission failed: ${err.message}`;
  }
}

// --- share ---
function currentShareCard() {
  return buildShareCard({
    game,
    theme,
    modeLabel: MODE_LABELS[mode],
    username: mode === 'graph' ? graphData?.username : null,
  });
}

function currentShareContext() {
  const username = mode === 'graph' ? graphData?.username : null;
  // A verified run has a share page whose preview shows this exact board.
  const url = lastReplayId
    ? `${location.origin}/r/${lastReplayId}`
    : gameUrl({ mode, username });
  return {
    text: shareText({ game, mode, day: session?.day, rank: lastRank, username }),
    url,
    username,
  };
}

async function copyResult() {
  const { text, url } = currentShareContext();
  const full = `${text}\n${url}`;
  try {
    await navigator.clipboard.writeText(full);
    $('btn-copy').textContent = 'Copied!';
    setTimeout(() => { $('btn-copy').textContent = 'Copy result'; }, 1500);
  } catch {
    $('overlay-sub').textContent = full;
  }
}

async function shareToNetwork(network) {
  const { text, url } = currentShareContext();
  const links = shareLinks(text, url);
  window.open(links[network], '_blank', 'noopener');
}

async function shareNative() {
  const { text, url, username } = currentShareContext();
  const canvas = buildShareCard({
    game, theme, modeLabel: MODE_LABELS[mode], username,
  });
  const ok = await nativeShare({ text, url, canvas });
  if (!ok) copyResult(); // fall back to clipboard
}

// --- input wiring ---
const KEY_DIRS = {
  ArrowUp: 0, w: 0, W: 0,
  ArrowRight: 1, d: 1, D: 1,
  ArrowDown: 2, s: 2, S: 2,
  ArrowLeft: 3, a: 3, A: 3,
};

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (state === 'spectating' || state === 'spectate-done') { exitSpectate(); return; }
    if (state === 'paused') { resumeGame(); return; }
    // Back out of a secondary menu panel to the start screen.
    if (state === 'idle' && (!$('leaderboard').hidden || !$('stats-panel').hidden
        || !$('achievements-panel').hidden)) {
      showStartScreen();
      return;
    }
  }
  if (e.key === ' ') {
    if (state === 'playing' || state === 'paused') {
      e.preventDefault();
      togglePause();
    }
    return;
  }
  const d = KEY_DIRS[e.key];
  if (d === undefined) return;
  // Don't hijack arrows while typing a username or name.
  if (document.activeElement?.tagName === 'INPUT') return;
  e.preventDefault();
  if (state === 'playing') {
    audio.unlock();
    queueInput(game, d);
  }
});

document.querySelectorAll('.touch-btn[data-dir]').forEach((btn) => {
  btn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (state === 'playing') {
      audio.unlock();
      // Only buzz when the input actually changes direction (queueInput returns
      // false for duplicates / reversals), so rapid taps don't rattle.
      if (queueInput(game, parseInt(btn.dataset.dir, 10)) && navigator.vibrate) {
        navigator.vibrate(8);
      }
    }
  }, { passive: false });
});

// Swipe to steer, tap to pause — directly on the board.
let touchStartX = 0, touchStartY = 0, touchStartT = 0;
canvas.addEventListener('touchstart', (e) => {
  const t = e.changedTouches[0];
  touchStartX = t.clientX;
  touchStartY = t.clientY;
  touchStartT = Date.now();
}, { passive: true });

canvas.addEventListener('touchend', (e) => {
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStartX;
  const dy = t.clientY - touchStartY;
  const absX = Math.abs(dx), absY = Math.abs(dy);
  if (absX < 24 && absY < 24) {
    if (Date.now() - touchStartT < 300) {
      if (state === 'spectating' || state === 'spectate-done') exitSpectate();
      else togglePause();
    }
    return;
  }
  if (state !== 'playing') return;
  audio.unlock();
  if (absX > absY) queueInput(game, dx > 0 ? 1 : 3);
  else queueInput(game, dy > 0 ? 2 : 0);
}, { passive: true });

// --- button wiring ---
$('pause-btn').addEventListener('click', togglePause);
$('btn-resume').addEventListener('click', resumeGame);
$('btn-classic').addEventListener('click', () => { audio.unlock(); startRun('classic'); });
$('btn-daily').addEventListener('click', () => { audio.unlock(); startRun('daily'); });
$('btn-graph').addEventListener('click', () => {
  $('user-row').hidden = false;
  $('username-input').value = localStorage.getItem('gh-snake-user') || '';
  $('username-input').focus();
});
$('user-row').addEventListener('submit', (e) => { e.preventDefault(); audio.unlock(); startGraphRun(); });
$('btn-again').addEventListener('click', () => startRun(mode));
$('btn-menu').addEventListener('click', showStartScreen);
$('home-link').setAttribute('href', import.meta.env.BASE_URL || '/');
$('home-link').addEventListener('click', goHome);
$('btn-share').addEventListener('click', () => downloadCard(currentShareCard()));
$('btn-copy').addEventListener('click', copyResult);
$('share-x').addEventListener('click', () => shareToNetwork('x'));
$('share-bluesky').addEventListener('click', () => shareToNetwork('bluesky'));
$('share-threads').addEventListener('click', () => shareToNetwork('threads'));
$('share-native').addEventListener('click', shareNative);
$('submit-row').addEventListener('submit', (e) => { e.preventDefault(); handleSubmit(); });
$('btn-leaderboard').addEventListener('click', showLeaderboardScreen);
$('lb-tab-classic').addEventListener('click', () => { setActiveTab('lb-tab-classic'); renderLeaderboard('classic'); });
$('lb-tab-daily').addEventListener('click', () => { setActiveTab('lb-tab-daily'); renderLeaderboard('daily'); });
$('lb-tab-yesterday').addEventListener('click', () => {
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  setActiveTab('lb-tab-yesterday');
  renderLeaderboard('daily', yesterday);
});
$('lb-back').addEventListener('click', showStartScreen);
$('btn-watch-best').addEventListener('click', watchLocalBest);
$('btn-watch-shared').addEventListener('click', () => {
  if (sharedReplay) startSpectate(sharedReplay.id, { returnTo: 'share' });
});
$('btn-play-own').addEventListener('click', () => exitSpectate({ toMenu: true }));
$('btn-stats').addEventListener('click', showStatsScreen);
$('stats-back').addEventListener('click', showStartScreen);
$('btn-achievements').addEventListener('click', showAchievementsScreen);
$('achievements-back').addEventListener('click', showStartScreen);
$('var-wrap').addEventListener('change', (e) => {
  localStorage.setItem('gh-snake-var-wrap', e.target.checked ? '1' : '0');
  updateVariantNote();
});
$('var-chill').addEventListener('change', (e) => {
  localStorage.setItem('gh-snake-var-chill', e.target.checked ? '1' : '0');
  updateVariantNote();
});

// Click (or keyboard-activate) a leaderboard row to watch that run.
$('leaderboard').addEventListener('click', (e) => {
  const row = e.target.closest('[data-replay]');
  if (row) startSpectate(row.dataset.replay);
});
$('leaderboard').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const row = e.target.closest('[data-replay]');
  if (row) { e.preventDefault(); startSpectate(row.dataset.replay); }
});

// Auto-pause when the tab loses focus — no unfair deaths in the background.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'playing') pauseGame();
});

function refreshTheme() {
  theme = applyTheme(themeName, palette);
  renderer.theme = theme;
  $('theme-btn').innerHTML = themeName === 'dark' ? icons.moon : icons.sun;
  if (game && state !== 'playing' && state !== 'spectating') {
    draw(renderer, game, null, 1, { monthLabels, ghost });
  }
}

$('theme-btn').addEventListener('click', () => {
  themeName = themeName === 'dark' ? 'light' : 'dark';
  refreshTheme();
});

$('palette-btn').addEventListener('click', () => {
  palette = palette === 'green' ? 'blue' : 'green';
  refreshTheme();
  announce(palette === 'blue' ? 'Colorblind palette on.' : 'Colorblind palette off.');
});

$('sound-btn').addEventListener('click', () => {
  audio.unlock();
  const muted = audio.toggleMute();
  $('sound-btn').innerHTML = muted ? icons.volumeOff : icons.volumeOn;
  $('sound-btn').setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
  if (!muted) audio.playClick();
});

// Re-apply DPI scaling if the display / zoom changes.
window.addEventListener('resize', () => {
  if (!renderer.cols) return;
  resizeBoard(renderer, renderer.cols, renderer.rows);
  if (game) draw(renderer, game, null, 1, { monthLabels, ghost });
});

// Register service worker for offline play (production only).
if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// --- boot ---
(async function boot() {
  $('theme-btn').innerHTML = themeName === 'dark' ? icons.moon : icons.sun;
  $('palette-btn').innerHTML = icons.palette;
  $('sound-btn').innerHTML = audio.isMuted() ? icons.volumeOff : icons.volumeOn;
  $('share-native').innerHTML = icons.share;
  $('share-x').innerHTML = icons.x;
  $('share-bluesky').innerHTML = icons.bluesky;
  $('share-threads').innerHTML = icons.threads;
  document.querySelectorAll('.touch-btn[data-dir]').forEach((btn) => {
    btn.innerHTML = [icons.up, icons.right, icons.down, icons.left][btn.dataset.dir];
  });

  // Draw an idle classic board behind the start overlay.
  game = createGame({ mode: 'classic', seed: randomSeed() });
  resizeBoard(renderer, game.cols, game.rows);
  draw(renderer, game, null, 1, {});
  updateUI();

  serverOk = await api.checkServer();
  showStartScreen();

  // Deep links from shares: ?user=<github-username> primes graph mode,
  // ?daily=1 spotlights the daily challenge. No autostart — the first
  // interaction stays a deliberate click (and unlocks audio).
  const params = new URLSearchParams(location.search);
  const watchId = params.get('watch');
  if (watchId && /^[0-9A-Za-z-]{6,40}$/.test(watchId) && serverOk) {
    startSpectate(watchId, { returnTo: 'share' });
    return;
  }
  const linkedUser = params.get('user');
  if (linkedUser && /^[a-zA-Z0-9-]{1,39}$/.test(linkedUser) && serverOk) {
    $('user-row').hidden = false;
    $('username-input').value = linkedUser;
    $('overlay-sub').textContent = `You've been challenged: eat @${linkedUser}'s year.`;
  } else if (params.get('daily') && serverOk) {
    $('overlay-sub').textContent = "Today's board is waiting. One try to rule the leaderboard.";
    $('btn-daily').focus();
  }
})();

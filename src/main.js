import './style.css';
import { createGame, queueInput, step, boardSize, ROTTEN_PENALTY } from './game/core.js';
import { botSteer } from './game/bot.js';
import { randomSeed } from './game/rng.js';
import {
  createRenderer, resizeBoard, draw, spawnParticles, spawnFloatingText,
  startDeathEffect, startNomFace, clearEffects, effectsActive,
} from './render/renderer.js';
import { loadThemeSetting, loadPalette, applyTheme } from './theme.js';
import * as audio from './audio.js';
import * as api from './api.js';
import {
  buildShareCard, downloadCard, shareText, gameUrl, shareLinks, nativeShare,
} from './share.js';
import { icons } from './icons.js';
import { ACHIEVEMENTS, loadUnlocked, reconcileUnlocked, evaluate as evaluateAchievements } from './achievements.js';
import {
  escapeHtml, announce, haptic, toast, showOverlay, hideOverlay,
  setTouchControls, skipCountdown, runCountdown,
} from './ui.js';
import {
  ghostFromRun, buildDailyField, advanceGhost, styleGhosts, updateRaceStrip,
} from './race.js';
import {
  startSpectate, watchLocalBest, seekSpectate, exitSpectate, toggleClip,
} from './spectate.js';

const $ = (id) => document.getElementById(id);

const canvas = $('game');
const renderer = createRenderer(canvas);

let themeSetting = loadThemeSetting(); // 'auto' | 'dark' | 'light'
let palette = loadPalette();
let theme = applyTheme(themeSetting, palette);
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
// Cap catch-up steps per animation frame. Without this a slow frame (GC, a
// background tab, a heavy machine) lets the accumulator fast-forward several
// steps at once — and since only the last step is interpolated, the snake
// visibly teleports across cells. Clamping turns a hitch into a tiny pause
// instead of a multi-cell skip; leftover backlog is dropped (below) so a
// persistently slow frame can't spiral.
const MAX_STEPS_PER_FRAME = 2;
let serverOk = false;
let submitted = false;
let lastRank = null;
let lastReplayId = null;
let sharedReplay = null; // { id, name, score } for the "watch again" button
// Translucent replay opponents racing on the same board. The daily runs a
// crowd: the whole top-10's replays at once (plus your best / a chosen
// rival, which gets the `primary` spotlight). Classic/graph race-your-best
// is a field of one. Each entry: { game, inputs, ptr, acc, prevSnake, alpha,
// name, finalScore, primary?, renderAlpha, showName } — the last two are
// restyled every frame (nearest rival bright + named, the rest a whisper).
let ghosts = [];
// Spectate mode playback: { inputs, ptr, name, score }
let spect = null;
let spectSpeed = 1; // 1 | 2 | 4 playback multiplier
let lastDeathCause = null; // 'wall' | 'self' from the fatal step

const MODE_LABELS = { classic: 'Classic', daily: 'Daily challenge', graph: 'Your graph' };

// Shared mutable state, handed to the extracted ui/race/spectate modules so
// they read and write the same game state main owns without importing main
// (which would be circular). Getters/setters proxy main's module-level lets;
// the methods are main callbacks the modules invoke.
const ctx = {
  renderer,
  MAX_STEPS_PER_FRAME,
  get game() { return game; }, set game(v) { game = v; },
  get prevSnake() { return prevSnake; }, set prevSnake(v) { prevSnake = v; },
  get accumulator() { return accumulator; }, set accumulator(v) { accumulator = v; },
  get lastTime() { return lastTime; }, set lastTime(v) { lastTime = v; },
  get state() { return state; }, set state(v) { state = v; },
  get mode() { return mode; }, set mode(v) { mode = v; },
  get session() { return session; }, set session(v) { session = v; },
  get ghosts() { return ghosts; }, set ghosts(v) { ghosts = v; },
  get monthLabels() { return monthLabels; }, set monthLabels(v) { monthLabels = v; },
  get spect() { return spect; }, set spect(v) { spect = v; },
  get spectSpeed() { return spectSpeed; }, set spectSpeed(v) { spectSpeed = v; },
  get sharedReplay() { return sharedReplay; }, set sharedReplay(v) { sharedReplay = v; },
  get theme() { return theme; },
  bestLocalRun,
  showStartScreen,
  showLeaderboardScreen,
  updateUI,
  updatePauseButton,
};

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
    rotten: localStorage.getItem('gh-snake-var-rotten') === '1',
  };
}

function variantsActiveFor(m) {
  const v = getVariants();
  return (v.wrap || v.chill || v.rotten) && m !== 'daily';
}

function racePref() {
  return localStorage.getItem('gh-snake-var-race') === '1';
}

function updateVariantNote() {
  const v = getVariants();
  const race = racePref();
  $('var-wrap').checked = v.wrap;
  $('var-chill').checked = v.chill;
  $('var-rotten').checked = v.rotten;
  $('var-race').checked = race;
  const notes = [];
  if (v.wrap || v.chill || v.rotten) notes.push('Variant runs are unranked (classic and graph only).');
  if (race) notes.push('Race a translucent ghost of your best run — classic reuses that board (unranked).');
  $('variant-note').textContent = notes.join(' ');
  $('variant-note').hidden = notes.length === 0;
  // The disclosure's summary names whatever is on, so collapsing the panel
  // never hides active gameplay modifiers.
  const active = [
    v.wrap && 'wrap', v.chill && 'chill', v.rotten && 'rotten', race && 'race best',
  ].filter(Boolean);
  $('variant-summary').innerHTML = active.length
    ? `Variants · <span class="variant-summary-active">${active.join(' + ')}</span>`
    : 'Variants';
}

function updateUI() {
  $('score').textContent = game ? game.score : 0;
  const streak = game ? game.streak : 0;
  $('streak').textContent = game && game.multiplier > 1 ? `${streak} ×${game.multiplier}` : String(streak);
  // Graph mode's real goal is clearing the year, so show progress toward it
  // where the level (which graph mode derives from progress anyway) would be.
  if (game && game.mode === 'graph' && game.totalCells) {
    $('level-label').textContent = 'Days:';
    $('level').textContent = `${game.totalCells - game.cells.size}/${game.totalCells}`;
    $('level').style.minWidth = '7ch'; // reserve width so the bar doesn't pulse
  } else {
    $('level-label').textContent = 'Level:';
    $('level').textContent = game ? game.level : 1;
    $('level').style.minWidth = '';
  }
  $('best').textContent = getHighScore();
}

// One-time hint for touch players: swiping isn't discoverable, and the
// controls-hint line is desktop-only. Shown as a toast on the first run.
function maybeTouchHint() {
  if (localStorage.getItem('gh-snake-touch-hint')) return;
  if (!window.matchMedia('(pointer: coarse)').matches) return;
  localStorage.setItem('gh-snake-touch-hint', '1');
  toast(icons.right, 'Steer with a swipe', 'Drag anywhere on the board — or use the pad below.');
}

function updatePauseButton() {
  const btn = $('pause-btn');
  const active = state === 'playing' || state === 'paused';
  btn.disabled = !active;
  btn.innerHTML = state === 'paused' ? icons.play : icons.pause;
  btn.setAttribute('aria-label', state === 'paused' ? 'Resume' : 'Pause');
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
  showOverlay(ctx,
    'GitSnake',
    best > 0 ? `Eat commits. Grow your streak. Best: ${best}.` : 'Eat commits. Grow your streak.',
    ['mode-buttons', ...(serverOk ? ['btn-leaderboard'] : []),
      ...(localBest ? ['btn-watch-best'] : []),
      ...(stats.games > 0 ? ['btn-stats', 'btn-achievements'] : []),
      ...(installPrompt ? ['btn-install'] : [])]
  );
  if (localBest) {
    $('btn-watch-best').textContent = `Watch your best run (${localBest.score} pts)`;
  }
  // No saved run yet -> nothing to race; keep the toggle out of the way.
  $('var-race-label').hidden = !localBest;
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

function bestRunFor(m) {
  // An empty input log is still a valid (if turn-free) run — same acceptance
  // as the "watch your best" button, so racing never silently no-ops.
  const run = JSON.parse(localStorage.getItem(`gh-snake-bestrun-${m}`) || 'null');
  return Array.isArray(run?.inputs) ? run : null;
}

// raceReplayId: race a specific verified run (from a daily leaderboard row)
// as the ghost instead of the default opponent.
async function startRun(selectedMode, { raceReplayId = null } = {}) {
  if (state === 'loading') return;
  mode = selectedMode;
  session = null;
  submitted = false;
  lastRank = null;
  lastReplayId = null;
  sharedReplay = null;
  ghosts = [];
  spect = null;
  lastDeathCause = null;
  monthLabels = mode === 'graph' ? graphData.months : null;

  // Variant runs (wrap walls / chill speed / rotten commits) are unranked: no
  // session is created, so there is nothing to submit — fairness by absence.
  const variants = variantsActiveFor(mode)
    ? getVariants()
    : { wrap: false, chill: false, rotten: false };
  const useVariants = variants.wrap || variants.chill || variants.rotten;

  // Race-your-best: a ghost of your best local run for this mode. Classic
  // has to replay that run's exact board (its seed and rules), so it skips
  // the session and plays unranked; daily and graph boards already match.
  const raceRun = racePref() ? bestRunFor(mode) : null;
  const raceClassic = mode === 'classic' && !!raceRun;

  let seed = randomSeed();
  let rules; // undefined -> createGame's current default
  if (serverOk && !useVariants && !raceClassic) {
    state = 'loading';
    try {
      session = await api.createSession(mode, mode === 'graph' ? graphData.username : undefined);
      seed = session.seed;
      // Play under the rules the server will replay with (old servers omit it).
      rules = session.rules || 1;
    } catch (err) {
      session = null;
      if (mode === 'daily') {
        state = 'idle';
        showStartScreen();
        $('overlay-sub').textContent = `Couldn't start the daily challenge: ${err.message}`;
        return;
      }
    }
    if (mode === 'daily' && session) {
      // Crowd race: everyone on today's board runs alongside you (plus your
      // best / a picked rival, which gets the primary spotlight).
      ghosts = await buildDailyField(session, { raceReplayId, raceRun });
    }
  }

  if (raceClassic) {
    // Replica of your best run's world: same seed, same rules, same variants.
    seed = raceRun.seed;
    rules = raceRun.rules || 1;
    variants.wrap = raceRun.wrap || false;
    variants.chill = (raceRun.speedFactor || 1) !== 1;
    variants.rotten = raceRun.rotten || false;
    ghosts = [Object.assign(ghostFromRun(raceRun, 'your best'), { primary: true })];
  } else if (mode === 'graph' && raceRun && raceRun.username === graphData.username) {
    // Same graph, so the ghost lines up cell for cell; ranked play unaffected.
    ghosts = [Object.assign(ghostFromRun(raceRun, 'your best'), { primary: true })];
  }

  game = createGame({
    mode,
    seed,
    graph: mode === 'graph' ? graphData.grid : null,
    wrap: variants.wrap,
    speedFactor: variants.chill ? 1.5 : 1,
    rotten: variants.rotten,
    ...(rules ? { rules } : {}),
  });
  const { cols, rows } = boardSize(mode);
  if (renderer.cols !== cols || renderer.rows !== rows) resizeBoard(renderer, cols, rows);
  clearEffects(renderer);
  prevSnake = null;
  accumulator = 0;

  const primaryGhost = ghosts.find((g) => g.primary) || null;
  const variantTag = raceClassic
    ? ' · racing your best (unranked)'
    : useVariants
      ? ` · ${[variants.wrap && 'wrap', variants.chill && 'chill', variants.rotten && 'rotten']
        .filter(Boolean).join(' + ')} (unranked)`
      : primaryGhost ? ` · racing ${primaryGhost.name}`
        : ghosts.length > 1 ? ` · racing the field (${ghosts.length})`
          : ghosts.length === 1 ? ` · racing ${ghosts[0].name}` : '';
  $('board-label').textContent = (
    mode === 'graph' ? `@${graphData.username} · last 12 months`
      : mode === 'daily' ? `Daily challenge · ${session.day}`
        : 'Snake graph') + variantTag;

  hideOverlay();
  state = 'resuming';
  setTouchControls(ctx, true);
  updatePauseButton();
  updateUI();
  announce(`${MODE_LABELS[mode]} started.`);
  maybeTouchHint();
  // Open every run on the same 3-2-1 as resume, so you're never dropped
  // straight onto a moving snake. The board is drawn frozen underneath.
  draw(renderer, game, null, 1, { monthLabels, ghosts });
  runCountdown(ctx, () => {
    if (state !== 'resuming') return; // aborted (navigated away / restarted)
    state = 'playing';
    updatePauseButton();
    lastTime = performance.now();
    accumulator = 0;
    requestAnimationFrame(tick);
  });
}

function handleStepEvents(ev) {
  if (ev.ate) {
    if (ev.golden) {
      spawnParticles(renderer, ev.head.x, ev.head.y, theme.gold, 14);
      startNomFace(renderer);
      spawnFloatingText(renderer, ev.head.x, ev.head.y, `+${ev.points}`, true);
      audio.playGolden();
      haptic([0, 12, 30, 12]);
    } else {
      spawnParticles(renderer, ev.head.x, ev.head.y, theme.food, 8);
      startNomFace(renderer);
      spawnFloatingText(renderer, ev.head.x, ev.head.y, `+${ev.points}`);
      audio.playEat(game.streak);
      haptic(6);
    }
    if (ev.levelUp) {
      spawnFloatingText(renderer, ev.head.x, ev.head.y, `LEVEL ${game.level}`, true);
      audio.playLevelUp();
      haptic([0, 18, 40, 18]);
      announce(`Level ${game.level}`);
    }
    if (ev.goldenSpawned) announce('Golden commit on the board — grab it before it fades.');
    updateUI();
  }
  if (ev.rotten) {
    spawnParticles(renderer, ev.head.x, ev.head.y, theme.death, 10);
    spawnFloatingText(renderer, ev.head.x, ev.head.y, `-${ROTTEN_PENALTY}`);
    audio.playRotten();
    haptic([0, 30, 30, 30]);
    announce('Rotten commit — streak lost.');
    updateUI();
  }
  if (ev.won) {
    audio.playWin();
    haptic([0, 40, 60, 40, 60, 80]);
    finishRun(true);
  } else if (ev.died) {
    lastDeathCause = ev.cause || null;
    audio.playDeath();
    haptic([0, 90, 40, 90]);
    startDeathEffect(renderer, game.snake);
    state = 'dying';
    requestAnimationFrame(dyingTick);
  }
}

function tick(now) {
  if (state !== 'playing') return;
  const dt = Math.min(250, now - lastTime);
  lastTime = now;
  accumulator += dt;

  for (const g of ghosts) advanceGhost(g, dt);

  let steps = 0;
  while (accumulator >= game.speed && steps < MAX_STEPS_PER_FRAME) {
    prevSnake = game.snake.map((s) => ({ ...s }));
    const ev = step(game);
    handleStepEvents(ev);
    if (state !== 'playing') return;
    accumulator -= game.speed;
    steps++;
  }
  // Drop any backlog we didn't consume so the next frame doesn't teleport.
  if (accumulator > game.speed) accumulator = game.speed;

  const pos = styleGhosts(ctx);
  if (ghosts.length) updateRaceStrip(`P${pos} · ${ghosts.length + 1} racers`, pos === 1);

  const alpha = Math.min(1, accumulator / game.speed);
  draw(renderer, game, prevSnake, alpha, { monthLabels, ghosts, showCombo: true });
  requestAnimationFrame(tick);
}

function dyingTick() {
  if (renderer.deathFlashTimer <= 0 && !effectsActive(renderer)) {
    finishRun(false);
    return;
  }
  draw(renderer, game, null, 1, { monthLabels, ghosts });
  requestAnimationFrame(dyingTick);
}

function finishRun(won) {
  state = 'over';
  updatePauseButton();
  const prevBest = getHighScore();
  const isNewBest = game.score > prevBest && game.score > 0;
  const best = Math.max(prevBest, game.score);
  localStorage.setItem(highScoreKey(), String(best));
  updateUI();

  recordStats();

  // Unlock achievements from the freshly-updated lifetime stats plus this run.
  const variant = !!(game.wrap || (game.speedFactor && game.speedFactor !== 1) || game.rottenVariant);
  const unlocked = evaluateAchievements({
    stats: loadStats(),
    run: { score: game.score, bestStreak: game.bestStreak, won, mode, variant, golden: game.goldenEaten },
  });
  for (const a of unlocked) toast(a.icon, `${a.name} unlocked`, a.desc);

  // Keep your best run per mode locally so it can be re-watched (and raced as
  // a ghost) anytime. The rules version rides along so replays stay faithful.
  if (game.stepCount > 0) {
    const runKey = `gh-snake-bestrun-${mode}`;
    const prevRun = JSON.parse(localStorage.getItem(runKey) || 'null');
    if (!prevRun || game.score > prevRun.score) {
      localStorage.setItem(runKey, JSON.stringify({
        mode,
        seed: game.seed,
        rules: game.rules,
        inputs: game.inputLog,
        score: game.score,
        wrap: game.wrap || undefined,
        speedFactor: game.speedFactor !== 1 ? game.speedFactor : undefined,
        rotten: game.rottenVariant || undefined,
        day: mode === 'daily' ? session?.day : undefined,
        username: mode === 'graph' ? graphData.username : undefined,
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

  // Daily is one-shot: once a score is ranked today, later runs are practice.
  const dailyResult = mode === 'daily' && session?.day
    ? JSON.parse(localStorage.getItem(`gh-snake-daily-${session.day}`) || 'null')
    : null;
  const dailyRanked = !!dailyResult?.rank;
  const canSubmit = !!session && serverOk && !dailyRanked;

  // Headline numbers as stat blocks (same visual language as the stats
  // panel) instead of prose lines that repeat each other.
  const eaten = game.totalCells ? game.totalCells - game.cells.size : 0;
  const blocks = mode === 'graph'
    ? [
      [game.score, 'points'],
      [`${eaten}/${game.totalCells}`, 'days eaten'],
      [game.bestStreak, 'best streak'],
      [best, 'best score'],
    ]
    : [
      [game.score, 'contributions'],
      [game.bestStreak, 'best streak'],
      ...(game.goldenEaten > 0 ? [[game.goldenEaten, 'golden']] : []),
      [best, 'best'],
    ];
  let statsHtml = `<div class="over-stat-row">${blocks.map(([n, label]) =>
    `<div class="stat-block"><div class="stat-number">${n}</div><div class="stat-name">${label}</div></div>`).join('')}</div>`;

  // Race verdicts. A spotlit rival gets the head-to-head line; a crowd race
  // says where you finished in today's field (by everyone's final score) —
  // which doubles as the submit nudge, so previewRank stays out of the way.
  const verdicts = [];
  const rival = ghosts.find((g) => g.primary) || (ghosts.length === 1 ? ghosts[0] : null);
  if (rival && rival.finalScore != null) {
    const diff = game.score - rival.finalScore;
    const who = escapeHtml(rival.name);
    verdicts.push(diff > 0
      ? `You beat ${who} (${rival.finalScore}) by <strong>${diff}</strong>!`
      : diff === 0
        ? `Dead heat with ${who} — <strong>${rival.finalScore}</strong> each.`
        : `${who} finished <strong>${-diff}</strong> ahead (${rival.finalScore}).`);
  }
  let fieldPos = null;
  let fieldSize = null;
  if (ghosts.length >= 2) {
    const finals = ghosts.filter((g) => g.finalScore != null);
    fieldPos = 1 + finals.filter((g) => g.finalScore > game.score).length;
    fieldSize = finals.length + 1;
    let line = `You finished <strong>#${fieldPos}</strong> of ${fieldSize} in today's field`;
    if (!rival) {
      // No named rival: point at the nearest runs either side of you.
      const sorted = [...finals].sort((a, b) => a.finalScore - b.finalScore);
      const aheadG = sorted.find((g) => g.finalScore > game.score);
      const behindG = [...sorted].reverse().find((g) => g.finalScore <= game.score);
      const bits = [];
      if (aheadG) bits.push(`${aheadG.finalScore - game.score} behind ${escapeHtml(aheadG.name)}`);
      if (behindG) {
        bits.push(game.score === behindG.finalScore
          ? `level with ${escapeHtml(behindG.name)}`
          : `${game.score - behindG.finalScore} ahead of ${escapeHtml(behindG.name)}`);
      }
      if (bits.length) line += ` — ${bits.join(', ')}`;
    }
    verdicts.push(`${line}.${canSubmit ? ' Submit it!' : ''}`);
  }
  statsHtml += `<div class="over-verdicts">${verdicts.map((v) => `<div>${v}</div>`).join('')}</div>`;

  const causeLine = lastDeathCause === 'wall' ? 'Ran into the wall'
    : lastDeathCause === 'self' ? 'Bit your own tail' : null;
  const modeLine = mode === 'daily'
    ? `Daily challenge · ${session?.day || ''}${dailyRanked ? ' · practice (first score counts)' : ''}`
    : 'Don’t break the build.';
  showOverlay(ctx,
    won ? 'You ate the whole year!' : isNewBest ? 'New personal best!' : 'Game Over',
    won ? 'Every contribution devoured.' : causeLine ? `${causeLine} · ${modeLine}` : modeLine,
    ['over-stats', 'over-actions', 'share-row', ...(canSubmit ? ['submit-row'] : [])]
  );
  $('share-native').hidden = !navigator.share;
  $('over-stats').innerHTML = statsHtml;
  if (canSubmit) {
    $('name-input').value = localStorage.getItem('gh-snake-name') || '';
    $('btn-submit').disabled = false;
    $('btn-submit').textContent = 'Submit score';
    // The crowd-race field verdict already says where you'd land (and nudges
    // the submit), so the async rank preview only runs without one.
    if (fieldPos == null) previewRank();
  }
  const unlockedMsg = unlocked.length
    ? ` Achievement${unlocked.length > 1 ? 's' : ''} unlocked: ${unlocked.map((a) => a.name).join(', ')}.`
    : '';
  const verdictMsg = rival && rival.finalScore != null
    ? (game.score > rival.finalScore
      ? ` You beat ${rival.name} by ${game.score - rival.finalScore}.`
      : game.score === rival.finalScore
        ? ` Dead heat with ${rival.name}.`
        : ` ${rival.name} finished ${rival.finalScore - game.score} ahead.`)
    : fieldPos != null ? ` Finished number ${fieldPos} of ${fieldSize} in today's field.` : '';
  announce(`${won ? 'You won!' : isNewBest ? 'New personal best!' : 'Game over.'} `
    + `${game.score} points, best streak ${game.bestStreak}.${verdictMsg}${unlockedMsg}`);
}

// Tease where this score would land before the player decides to submit.
async function previewRank() {
  if (game.score <= 0) return;
  const scoreAtCall = game.score;
  try {
    const { entries } = await (mode === 'graph'
      ? api.getLeaderboard('graph', null, graphData.username)
      : api.getLeaderboard(mode === 'daily' ? 'daily' : 'classic',
        mode === 'daily' ? session.day : undefined));
    if (state !== 'over' || submitted || game.score !== scoreAtCall) return;
    const rank = entries.filter((e) => e.score > scoreAtCall).length + 1;
    if (rank > 20 && entries.length >= 20) return; // wouldn't make the board
    $('over-stats').querySelector('.over-verdicts')?.insertAdjacentHTML('beforeend',
      `<div>This run would rank <strong>#${rank}</strong>${mode === 'daily' ? ' today' : ''} — submit it!</div>`);
  } catch { /* preview only — never block the game-over screen */ }
}

// --- pause / resume ---
function pauseGame() {
  if (state !== 'playing') return;
  state = 'paused';
  updatePauseButton();
  const streakBit = game.streak > 0 ? ` · streak ${game.streak}` : '';
  showOverlay(ctx, 'Paused',
    `Score ${game.score}${streakBit}. Take a break — your streak will wait.`,
    ['btn-resume']);
}

function resumeGame() {
  if (state !== 'paused') return;
  hideOverlay();
  state = 'resuming';
  setTouchControls(ctx, true);
  updatePauseButton();
  // A brief 3-2-1 so you're never dropped straight back into a moving snake
  // after a pause or a tab switch. Redraw the frozen board underneath each beat.
  runCountdown(ctx, () => {
    if (state !== 'resuming') return; // aborted (e.g. went home)
    state = 'playing';
    updatePauseButton();
    lastTime = performance.now();
    accumulator = 0;
    requestAnimationFrame(tick);
  });
}

function togglePause() {
  if (state === 'playing') pauseGame();
  else if (state === 'paused') resumeGame();
}

// --- leaderboard ---
// The username whose graph leaderboard to show: the graph you just played,
// falling back to the last one you searched for.
function graphLbUser() {
  return graphData?.username || localStorage.getItem('gh-snake-user') || null;
}

async function renderLeaderboard(lbMode) {
  const el = $('leaderboard');
  el.hidden = false;
  el.innerHTML = '<div class="lb-empty">Loading…</div>';
  try {
    const day = lbMode === 'daily' ? new Date().toISOString().slice(0, 10) : undefined;
    const user = lbMode === 'graph' ? graphLbUser() : undefined;
    const { entries, day: actualDay } = await api.getLeaderboard(lbMode, day, user);
    if (!entries.length) {
      el.innerHTML = `<div class="lb-empty">No scores yet${lbMode === 'daily' ? ' today' : ''}${lbMode === 'graph' ? ` on @${escapeHtml(user)}'s graph` : ''}. Be the first!</div>`;
      return;
    }
    // Today's daily runs share today's seed, so any of them can be raced live.
    const raceable = lbMode === 'daily' && serverOk;
    // The all-time board mixes modes, so each row shows where the run came from.
    const showWhere = lbMode === 'all';
    const myName = localStorage.getItem('gh-snake-name');
    el.innerHTML = entries.map((e, i) => `
      <div class="lb-row${e.name === myName ? ' me' : ''}${e.replayId ? ' watchable' : ''}"
           ${e.replayId ? `data-replay="${escapeHtml(e.replayId)}" role="button" tabindex="0" title="Watch this run"` : ''}>
        <span class="lb-rank">${i + 1}</span>
        <span class="lb-name">${escapeHtml(e.name)}</span>
        ${showWhere ? `<span class="lb-where">${escapeHtml(lbWhere(e))}</span>` : ''}
        <span class="lb-score">${e.score}</span>
        ${e.replayId && raceable ? `<button class="lb-race" type="button" data-race="${escapeHtml(e.replayId)}"
            title="Race this run" aria-label="Race ${escapeHtml(e.name)}'s run">${icons.race}</button>` : ''}
        ${e.replayId ? `<span class="lb-watch" aria-hidden="true">${icons.play}</span>` : ''}
      </div>`).join('');
    if (lbMode === 'daily' && actualDay) {
      el.insertAdjacentHTML('afterbegin', `<div class="lb-empty">Daily · ${actualDay}</div>`);
    } else if (lbMode === 'graph') {
      el.insertAdjacentHTML('afterbegin', `<div class="lb-empty">Graph · @${escapeHtml(user)}</div>`);
    } else if (lbMode === 'all') {
      el.insertAdjacentHTML('afterbegin', '<div class="lb-empty">Top scores across every mode</div>');
    }
    // Bring your own row into view — most useful right after submitting.
    el.querySelector('.lb-row.me')?.scrollIntoView({ block: 'nearest' });
  } catch (err) {
    el.innerHTML = `<div class="lb-empty">Couldn't load leaderboard: ${escapeHtml(err.message)}</div>`;
  }
}

// Where an all-time entry was scored: whose graph, which daily, or classic.
function lbWhere(e) {
  if (e.mode === 'graph') return `@${e.day}`;
  if (e.mode === 'daily') return e.day ? `Daily ${e.day.slice(5)}` : 'Daily';
  return 'Classic';
}

function setActiveTab(activeId) {
  for (const id of ['lb-tab-all', 'lb-tab-daily', 'lb-tab-graph']) {
    const btn = $(id);
    const on = id === activeId;
    btn.classList.toggle('active', on);
    if (on) btn.setAttribute('aria-current', 'true');
    else btn.removeAttribute('aria-current');
  }
}

function showLeaderboardScreen(initialTab = 'all') {
  showOverlay(ctx, 'Leaderboard', 'Server-verified scores.', ['lb-tabs', 'leaderboard']);
  $('lb-tab-graph').hidden = !graphLbUser();
  setActiveTab(`lb-tab-${initialTab}`);
  renderLeaderboard(initialTab);
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
  showOverlay(ctx, 'Your stats', 'Stored locally in this browser.', ['stats-panel', 'stats-back']);
}

function showAchievementsScreen() {
  const unlocked = loadUnlocked();
  const stats = loadStats();
  $('achievements-panel').innerHTML = ACHIEVEMENTS.map((a) => {
    const got = unlocked.has(a.id);
    // Locked threshold achievements show how close you are.
    let progressHtml = '';
    if (!got && a.progress) {
      const [now, goal] = a.progress(stats);
      const shown = Math.min(now, goal);
      progressHtml = `
        <div class="achv-progress" aria-label="${shown} of ${goal}">
          <div class="achv-progress-track"><div class="achv-progress-fill"
               style="width:${Math.min(100, (now / goal) * 100)}%"></div></div>
          <span class="achv-progress-num">${shown}/${goal}</span>
        </div>`;
    }
    return `<div class="achv ${got ? 'unlocked' : 'locked'}">
      <div class="achv-badge" aria-hidden="true">${a.icon}</div>
      <div class="achv-text">
        <div class="achv-name">${escapeHtml(a.name)}</div>
        <div class="achv-desc">${escapeHtml(a.desc)}</div>
        ${progressHtml}
      </div>
      ${got ? `<span class="achv-check" aria-hidden="true">${icons.check}</span>` : ''}
    </div>`;
  }).join('');
  showOverlay(ctx, 'Achievements', `${unlocked.size} of ${ACHIEVEMENTS.length} unlocked`,
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
    $('overlay-sub').textContent = `Verified! You're #${result.rank} ${
      mode === 'daily' ? 'today' : mode === 'graph' ? `on @${graphData.username}'s graph` : 'in Classic'}.`;
    $('leaderboard').hidden = false;
    renderLeaderboard(mode === 'daily' ? 'daily' : mode === 'graph' ? 'graph' : 'classic');
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
    if (state === 'spectating' || state === 'spectate-done') { exitSpectate(ctx); return; }
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
  // Instant rematch from the game-over screen.
  if ((e.key === 'r' || e.key === 'R') && state === 'over'
      && document.activeElement?.tagName !== 'INPUT') {
    e.preventDefault();
    audio.unlock();
    startRun(mode);
    return;
  }
  const d = KEY_DIRS[e.key];
  if (d === undefined) return;
  // Don't hijack arrows while typing a username or name.
  if (document.activeElement?.tagName === 'INPUT') return;
  e.preventDefault();
  // A direction key during the 3-2-1 skips it and steers immediately.
  if (state === 'resuming' && skipCountdown()) {
    audio.unlock();
    queueInput(game, d);
    return;
  }
  if (state === 'playing') {
    audio.unlock();
    queueInput(game, d);
  }
});

document.querySelectorAll('.touch-btn[data-dir]').forEach((btn) => {
  btn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (state === 'resuming') skipCountdown(); // d-pad also skips the 3-2-1
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

// Swipe to steer, tap to pause — directly on the board. Steering triggers on
// touchmove (as soon as the finger travels far enough) rather than waiting
// for the finger to lift, so flick-and-hold gestures turn a beat sooner at
// high speed; the origin re-arms after each turn so one continuous drag can
// chain several turns.
let touchStartX = 0, touchStartY = 0, touchStartT = 0;
let touchSteered = false;
const SWIPE_PX = 24;

canvas.addEventListener('touchstart', (e) => {
  const t = e.changedTouches[0];
  touchStartX = t.clientX;
  touchStartY = t.clientY;
  touchStartT = Date.now();
  touchSteered = false;
}, { passive: true });

canvas.addEventListener('touchmove', (e) => {
  if (state !== 'playing') return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStartX;
  const dy = t.clientY - touchStartY;
  const absX = Math.abs(dx), absY = Math.abs(dy);
  if (absX < SWIPE_PX && absY < SWIPE_PX) return;
  audio.unlock();
  if (absX > absY) queueInput(game, dx > 0 ? 1 : 3);
  else queueInput(game, dy > 0 ? 2 : 0);
  touchSteered = true;
  touchStartX = t.clientX;
  touchStartY = t.clientY;
}, { passive: true });

canvas.addEventListener('touchend', (e) => {
  if (touchSteered) return; // the move handler already steered this gesture
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStartX;
  const dy = t.clientY - touchStartY;
  const absX = Math.abs(dx), absY = Math.abs(dy);
  if (absX < SWIPE_PX && absY < SWIPE_PX) {
    if (Date.now() - touchStartT < 300) {
      if (state === 'resuming') skipCountdown(); // tap skips the 3-2-1
      else if (state === 'spectating' || state === 'spectate-done') exitSpectate(ctx);
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
$('btn-leaderboard').addEventListener('click', () => showLeaderboardScreen());
$('lb-tab-all').addEventListener('click', () => { setActiveTab('lb-tab-all'); renderLeaderboard('all'); });
$('lb-tab-daily').addEventListener('click', () => { setActiveTab('lb-tab-daily'); renderLeaderboard('daily'); });
$('lb-tab-graph').addEventListener('click', () => { setActiveTab('lb-tab-graph'); renderLeaderboard('graph'); });
$('lb-back').addEventListener('click', showStartScreen);
$('btn-watch-best').addEventListener('click', () => watchLocalBest(ctx));
$('btn-watch-shared').addEventListener('click', () => {
  if (sharedReplay) startSpectate(ctx, sharedReplay.id, { returnTo: 'share' });
});
$('btn-play-own').addEventListener('click', () => exitSpectate(ctx, { toMenu: true }));
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
$('var-rotten').addEventListener('change', (e) => {
  localStorage.setItem('gh-snake-var-rotten', e.target.checked ? '1' : '0');
  updateVariantNote();
});
$('var-race').addEventListener('change', (e) => {
  localStorage.setItem('gh-snake-var-race', e.target.checked ? '1' : '0');
  updateVariantNote();
});
$('btn-spect-speed').addEventListener('click', () => {
  spectSpeed = spectSpeed >= 4 ? 1 : spectSpeed * 2;
  $('btn-spect-speed').textContent = `${spectSpeed}×`;
});
$('btn-spect-clip').addEventListener('click', () => toggleClip(ctx));
$('spect-bar').addEventListener('click', (e) => {
  if (state !== 'spectating' && state !== 'spectate-done') return;
  const rect = e.currentTarget.getBoundingClientRect();
  seekSpectate(ctx, (e.clientX - rect.left) / rect.width);
});

// Click (or keyboard-activate) a leaderboard row to watch that run; the race
// button inside a row starts a live run against it instead.
$('leaderboard').addEventListener('click', (e) => {
  const race = e.target.closest('[data-race]');
  if (race) {
    audio.unlock();
    startRun('daily', { raceReplayId: race.dataset.race });
    return;
  }
  const row = e.target.closest('[data-replay]');
  if (row) startSpectate(ctx, row.dataset.replay);
});
$('leaderboard').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  if (e.target.closest('[data-race]')) return; // native button handles it
  const row = e.target.closest('[data-replay]');
  if (row) { e.preventDefault(); startSpectate(ctx, row.dataset.replay); }
});

// Auto-pause when the tab loses focus — no unfair deaths in the background.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'playing') pauseGame();
});

// --- PWA install nudge ---
// The browser only fires this when the app is installable and not installed;
// stash the prompt and surface a quiet "Install app" link on the start menu.
let installPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  if (state === 'idle' && $('mode-buttons') && !$('mode-buttons').hidden) {
    $('btn-install').hidden = false;
  }
});

window.addEventListener('appinstalled', () => {
  installPrompt = null;
  $('btn-install').hidden = true;
});

$('btn-install').addEventListener('click', async () => {
  if (!installPrompt) return;
  const prompt = installPrompt;
  installPrompt = null;
  $('btn-install').hidden = true;
  prompt.prompt();
  await prompt.userChoice.catch(() => {});
});

const THEME_ICONS = { auto: icons.autoTheme, dark: icons.moon, light: icons.sun };
const THEME_LABELS = {
  auto: 'Theme: auto (follows system)', dark: 'Theme: dark', light: 'Theme: light',
};

function refreshTheme() {
  theme = applyTheme(themeSetting, palette);
  renderer.theme = theme;
  $('theme-btn').innerHTML = THEME_ICONS[themeSetting];
  $('theme-btn').setAttribute('aria-label', THEME_LABELS[themeSetting]);
  if (game && state !== 'playing' && state !== 'spectating') {
    draw(renderer, game, null, 1, { monthLabels, ghosts });
  }
}

// Cycle dark → light → auto; auto tracks the system scheme live.
$('theme-btn').addEventListener('click', () => {
  themeSetting = { dark: 'light', light: 'auto', auto: 'dark' }[themeSetting];
  refreshTheme();
  announce(THEME_LABELS[themeSetting]);
});

window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  if (themeSetting === 'auto') refreshTheme();
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
  if (game) draw(renderer, game, null, 1, { monthLabels, ghosts });
});

// Register service worker for offline play (production only).
if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// --- boot ---
(async function boot() {
  // One-time: re-lock the achievements whose bars were raised so they're re-earned.
  reconcileUnlocked();

  $('theme-btn').innerHTML = THEME_ICONS[themeSetting];
  $('theme-btn').setAttribute('aria-label', THEME_LABELS[themeSetting]);
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
    startSpectate(ctx, watchId, { returnTo: 'share' });
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

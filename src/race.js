// Ghost racing: the translucent replay opponents that run alongside a live
// game (the daily crowd field, or a single race-your-best ghost), plus the
// live position pill. Ghosts each simulate their own deterministic game from a
// recorded run, so they replay faithfully under the rules they were played on.
// Leaf module: depends only on the core and the API, never on the UI or main.
import { createGame, queueInput, step } from './game/core.js';
import * as api from './api.js';

const $ = (id) => document.getElementById(id);

// The daily crowd field runs the whole top-N replays at once.
const FIELD_SIZE = 10;

// Build a ghost from any stored run (server replay or local best). The ghost
// simulates its own game under the seed/rules it was recorded with, so old
// runs replay faithfully even after gameplay-rule changes. finalScore is the
// run's known end score — the game-over screen uses it for the race verdict.
export function ghostFromRun(run, name) {
  return {
    game: createGame({
      mode: run.mode,
      seed: run.seed,
      graph: run.graph || null,
      wrap: run.wrap || false,
      speedFactor: run.speedFactor || 1,
      rotten: run.rotten || false,
      rules: run.rules || 1,
      day: run.day || null,
    }),
    inputs: run.inputs,
    ptr: 0,
    acc: 0,
    prevSnake: null,
    alpha: 1,
    name,
    finalScore: Number.isFinite(run.score) ? run.score : null,
  };
}

export function dailyReplayMatchesSession(run, session) {
  return run?.mode === 'daily'
    && run.day === session?.day
    && Number(run.seed) === Number(session?.seed)
    && (Number(run.rules) || 1) === (Number(session?.rules) || 1);
}

// Crowd race: everyone on today's board runs alongside you. The whole top-
// FIELD_SIZE replays the same seed; an explicitly-picked rival (leaderboard
// race button) or your own best gets the primary spotlight. All of it is a
// bonus — failures just thin the field, so any fetch error is swallowed.
export async function buildDailyField(session, { raceReplayId = null, raceRun = null } = {}) {
  const ghosts = [];
  const dailyGhost = (rd) => {
    if (!dailyReplayMatchesSession(rd, session)) return null;
    return ghostFromRun(rd, rd.name);
  };
  try {
    const { entries } = await api.getLeaderboard('daily', session.day);
    const field = entries.filter((e) => e.replayId).slice(0, FIELD_SIZE);
    const replays = await Promise.allSettled(field.map((e) => api.getReplay(e.replayId)));
    replays.forEach((res, i) => {
      if (res.status !== 'fulfilled') return;
      const g = dailyGhost(res.value);
      if (!g) return;
      if (field[i].replayId === raceReplayId) g.primary = true;
      ghosts.push(g);
    });
    // A picked rival outside the top field still joins (and leads).
    if (raceReplayId && !ghosts.some((g) => g.primary)) {
      const g = dailyGhost(await api.getReplay(raceReplayId));
      if (g) {
        g.primary = true;
        ghosts.push(g);
      }
    }
  } catch { /* racing is a bonus, never a blocker */ }
  if (raceRun && raceRun.day === session.day && raceRun.seed === session.seed
      && (raceRun.rules || 1) === (session.rules || 1)) {
    const g = ghostFromRun(raceRun, 'your best');
    if (!ghosts.some((x) => x.primary)) g.primary = true;
    ghosts.push(g);
  }
  return ghosts;
}

export function advanceGhost(ghost, dt) {
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

// Restyle the field each frame: an explicit rival (or, failing that, the
// nearest run still ahead of you) gets the spotlight — brighter and named —
// while the rest stay a quiet swarm and finished runs fade out. Under
// reduced motion only the spotlight renders. Returns your live position.
export function styleGhosts(ctx) {
  const { ghosts, game, renderer } = ctx;
  if (!ghosts.length) return 1;
  const primary = ghosts.find((g) => g.primary) || null;
  let nearest = null;
  let gap = Infinity;
  let ahead = 0;
  for (const g of ghosts) {
    const running = g.game.alive && !g.game.won;
    const score = running ? g.game.score : (g.finalScore ?? g.game.score);
    if (score > game.score) {
      ahead++;
      if (score - game.score < gap) { gap = score - game.score; nearest = g; }
    }
  }
  const spotlight = primary || nearest || ghosts[0];
  for (const g of ghosts) {
    const running = g.game.alive && !g.game.won;
    if (g === spotlight) {
      g.renderAlpha = running ? 0.3 : 0.12;
      g.showName = true;
    } else {
      g.renderAlpha = renderer.reduceMotion ? 0 : running ? 0.12 : 0.05;
      g.showName = false;
    }
  }
  return ahead + 1;
}

// Live position pill in the stats bar ("P4 · 11 racers").
let raceStripText = '';
export function updateRaceStrip(text, lead = false) {
  const el = $('race-pos');
  if (text === null) {
    el.hidden = true;
    raceStripText = '';
    return;
  }
  if (text !== raceStripText) {
    raceStripText = text;
    el.textContent = text;
    el.classList.toggle('lead', lead);
    el.hidden = false;
  }
}

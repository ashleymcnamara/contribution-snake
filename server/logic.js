// Storage-agnostic API logic. Every handler takes a store implementing the
// interface in stores/ (sqlite locally, Netlify Blobs in production, memory
// in tests) and returns { status, body } for the adapter to serialize.
import { createHash, randomUUID, randomInt } from 'node:crypto';
import { replayGame, validateInputLog, CURRENT_RULES } from '../src/game/core.js';
import { fetchContributionDays, toGrid, isValidUsername } from './github.js';
import { renderOgImage } from './ogimage.js';
import { renderSharePage } from './sharepage.js';

const SESSION_MAX_AGE_MS = 2 * 3600 * 1000;
const CONTRIB_TTL_MS = 10 * 60 * 1000;
// An honest run's wall-clock time is at least the sum of its step intervals.
// Reject anything meaningfully faster — blocks offline-searched (TAS) input
// logs submitted seconds after the session was issued.
const PACING_TOLERANCE = 0.85;

export const todayUTC = () => new Date().toISOString().slice(0, 10);

// Short, URL-friendly replay IDs keep share links tiny
// (yetanothersnake.dev/r/Ab3xK9pQ) instead of a 36-char UUID. Collision-checked
// against the store; the validator still accepts legacy UUID links too.
const ID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const REPLAY_ID_RE = /^[0-9A-Za-z-]{6,40}$/;

function shortId(len = 8) {
  let s = '';
  for (let i = 0; i < len; i++) s += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
  return s;
}

async function freshReplayId(store) {
  for (let i = 0; i < 5; i++) {
    const id = shortId();
    if (!(await store.getReplay(id))) return id;
  }
  return shortId(12); // vanishingly unlikely fallback
}

export function dailySeed(day, secret) {
  const hash = createHash('sha256').update(day + secret).digest();
  return hash.readUInt32BE(0) & 0x7fffffff;
}

// Light name hygiene for a public leaderboard: length, control chars, and a
// small slur/profanity blocklist (normalized against simple leetspeak).
const BLOCKED = ['fuck', 'shit', 'cunt', 'nigg', 'fagg', 'bitch', 'asshole', 'dick', 'hitler'];
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '!': 'i' };

export function sanitizeName(raw) {
  const name = String(raw ?? '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim()
    .slice(0, 20);
  if (!name) return 'anonymous';
  const normalized = name.toLowerCase().replace(/[0134578@$!]/g, (c) => LEET[c] ?? c);
  if (BLOCKED.some((w) => normalized.includes(w))) return 'player';
  return name;
}

export function health() {
  return { status: 200, body: { ok: true, day: todayUTC() } };
}

async function fetchContribPayload(store, username) {
  const key = username.toLowerCase();
  const cached = await store.getContribCache(key);
  if (cached && Date.now() - cached.fetchedAt < CONTRIB_TTL_MS) {
    return cached.payload;
  }
  const raw = await fetchContributionDays(username, process.env.GITHUB_TOKEN);
  const { grid, months } = toGrid(raw.days);
  const payload = { username, grid, months, total: raw.total, source: raw.source };
  await store.setContribCache(key, payload, Date.now());
  return payload;
}

export async function contributions(store, username) {
  if (!isValidUsername(username)) {
    return { status: 400, body: { error: 'That does not look like a GitHub username.' } };
  }
  try {
    return { status: 200, body: await fetchContribPayload(store, username) };
  } catch (err) {
    const notFound = /not found/i.test(err.message);
    return { status: notFound ? 404 : 502, body: { error: err.message } };
  }
}

// clientId: an anonymous per-browser token; for daily sessions it enforces
// "only your first submitted score counts today". username: graph mode only —
// the server fetches that user's grid itself, so the replayed board is trusted.
export async function createSession(store, mode, { username, clientId } = {}) {
  if (mode !== 'classic' && mode !== 'daily' && mode !== 'graph') {
    return { status: 400, body: { error: 'Unknown mode.' } };
  }
  const session = {
    id: randomUUID(),
    mode,
    day: null,
    rules: CURRENT_RULES,
    createdAt: Date.now(),
    used: false,
  };
  if (mode === 'daily') {
    session.day = todayUTC();
    session.seed = dailySeed(session.day, await store.getDailySecret());
    if (typeof clientId === 'string' && /^[0-9a-f-]{8,40}$/i.test(clientId)) {
      session.clientId = clientId;
    }
  } else {
    session.seed = randomInt(0, 0x7fffffff);
  }
  if (mode === 'graph') {
    if (!isValidUsername(username)) {
      return { status: 400, body: { error: 'Graph sessions need a GitHub username.' } };
    }
    let payload;
    try {
      payload = await fetchContribPayload(store, username);
    } catch (err) {
      return { status: 502, body: { error: err.message } };
    }
    if (!payload.grid.flat().some((l) => l > 0)) {
      return { status: 422, body: { error: 'That graph has nothing to eat.' } };
    }
    // Graph leaderboards are per-username: reuse the day column as the key.
    session.day = username.toLowerCase();
    session.graph = payload.grid;
    session.months = payload.months;
  }
  await store.createSession(session);
  return {
    status: 200,
    body: { sessionId: session.id, seed: session.seed, day: session.day, rules: session.rules },
  };
}

export async function submitScore(store, { sessionId, name, inputs }, now = Date.now()) {
  if (typeof sessionId !== 'string' || !validateInputLog(inputs)) {
    return { status: 400, body: { error: 'Malformed submission.' } };
  }
  const session = await store.getSession(sessionId);
  if (!session) return { status: 404, body: { error: 'Unknown session.' } };
  if (now - session.createdAt > SESSION_MAX_AGE_MS) {
    return { status: 410, body: { error: 'Session expired.' } };
  }

  // Replay the input log through the shared deterministic core; the score we
  // store is the one *we* computed, not the one the client claims. Old
  // sessions carry no rules and replay under v1.
  const rules = Number(session.rules) || 1;
  const final = replayGame({
    mode: session.mode, seed: Number(session.seed), graph: session.graph || null, rules,
  }, inputs);
  if (final.alive && !final.won) {
    return { status: 422, body: { error: 'Replay did not end — invalid run.' } };
  }

  // Pacing check: the run can't have taken less real time than its ticks add
  // up to. (Pauses only ever make elapsed time longer.)
  const elapsed = now - session.createdAt;
  if (elapsed < final.elapsedGameMs * PACING_TOLERANCE) {
    return { status: 422, body: { error: 'Run submitted faster than it could have been played.' } };
  }

  // Atomic claim — under concurrent submissions of the same session exactly
  // one wins, even on storage without transactions.
  if (!(await store.claimSession(sessionId))) {
    return { status: 409, body: { error: 'Score already submitted for this game.' } };
  }

  // Daily is one-shot per browser: the first submitted score is the one that
  // counts. Later sessions from the same client are still playable, but their
  // scores don't rank. (Anonymous token — determined cheaters can clear it;
  // this keeps the day honest for everyone playing normally.)
  if (session.mode === 'daily' && session.clientId) {
    if (!(await store.claimDailyRank(session.day, session.clientId))) {
      return {
        status: 409,
        body: { error: 'Only your first daily score counts — this run stays practice.' },
      };
    }
  }

  const cleanName = sanitizeName(name);
  const id = await freshReplayId(store);
  await store.putReplay(id, {
    seed: Number(session.seed),
    mode: session.mode,
    day: session.day,
    rules,
    ...(session.graph ? { graph: session.graph, months: session.months || null } : {}),
    inputs,
    name: cleanName,
    score: final.score,
  });
  await store.insertScore({
    id,
    mode: session.mode,
    day: session.day,
    name: cleanName,
    score: final.score,
    bestStreak: final.bestStreak,
    snakeLength: final.snake.length,
    createdAt: now,
  });
  const rank = await store.getRank(session.mode, session.day, final.score);
  return { status: 200, body: { score: final.score, bestStreak: final.bestStreak, rank, replayId: id } };
}

export async function leaderboard(store, { mode: rawMode, day: rawDay, user: rawUser }) {
  const mode = rawMode === 'daily' ? 'daily' : rawMode === 'graph' ? 'graph' : 'classic';
  let day = null;
  if (mode === 'daily') {
    day = rawDay || todayUTC();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return { status: 400, body: { error: 'Bad day format.' } };
    }
  } else if (mode === 'graph') {
    // Graph boards are per-username (stored in the day column).
    if (!isValidUsername(rawUser)) {
      return { status: 400, body: { error: 'Graph leaderboards need a username.' } };
    }
    day = rawUser.toLowerCase();
  }
  const entries = await store.getLeaderboard(mode, day, 20);
  return { status: 200, body: { mode, day, entries } };
}

export async function replay(store, id) {
  if (typeof id !== 'string' || !REPLAY_ID_RE.test(id)) {
    return { status: 400, body: { error: 'Bad replay id.' } };
  }
  const data = await store.getReplay(id);
  if (!data) return { status: 404, body: { error: 'Replay not found.' } };
  return { status: 200, body: data };
}

// PNG preview for link scrapers: replay the run and render the final board.
export async function ogImage(store, rawId) {
  const id = String(rawId).replace(/\.png$/, '');
  const res = await replay(store, id);
  if (res.status !== 200) return res;
  const data = res.body;
  const final = replayGame({
    mode: data.mode, seed: data.seed, graph: data.graph || null, rules: Number(data.rules) || 1,
  }, data.inputs);
  const buffer = renderOgImage({
    final, name: data.name, score: data.score, mode: data.mode, day: data.day,
  });
  return { status: 200, buffer, contentType: 'image/png' };
}

export async function sharePage(store, id, origin) {
  const res = await replay(store, id);
  if (res.status !== 200) {
    return { status: res.status, html: `<!DOCTYPE html><p>${res.body.error}</p>` };
  }
  const { name, score, mode, day } = res.body;
  return {
    status: 200,
    html: renderSharePage({ id, name, score, mode, day, origin }),
  };
}

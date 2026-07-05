// Netlify Blobs store for production on Netlify — zero provisioning needed.
//
// Ranking trick: blob stores have no ORDER BY, so the score is encoded into
// the key as a zero-padded *inverted* number (9999999 - score). Listing keys
// lexicographically then yields best-score-first, with ties broken by the
// earlier timestamp. The rank of a score is just how many keys sort before it.
import { getStore } from '@netlify/blobs';
import { randomBytes } from 'node:crypto';

const INV = 9999999;

function scoreKey(mode, day, score, createdAt, id) {
  const inv = String(INV - Math.min(score, INV)).padStart(7, '0');
  const ts = String(createdAt).padStart(14, '0');
  return `${mode}/${day || 'all'}/${inv}-${ts}-${id}`;
}

function scorePrefix(mode, day) {
  return `${mode}/${day || 'all'}/`;
}

async function listKeys(store, prefix) {
  const { blobs } = await store.list({ prefix });
  return blobs.map((b) => b.key).sort();
}

export function createBlobStore() {
  const sessions = getStore({ name: 'snake-sessions', consistency: 'strong' });
  const scores = getStore({ name: 'snake-scores', consistency: 'strong' });
  const replays = getStore({ name: 'snake-replays' });
  const contrib = getStore({ name: 'snake-contrib-cache' });
  const meta = getStore({ name: 'snake-meta', consistency: 'strong' });

  return {
    async getSession(id) {
      return (await sessions.get(id, { type: 'json' })) ?? null;
    },
    async createSession(session) {
      await sessions.setJSON(session.id, session);
    },
    // Atomic: onlyIfNew creates the claim marker exactly once; a losing
    // concurrent write comes back with modified: false.
    async claimSession(id) {
      const res = await sessions.set(`${id}/used`, '1', { onlyIfNew: true });
      return res?.modified !== false;
    },
    async insertScore(s) {
      await scores.setJSON(scoreKey(s.mode, s.day, s.score, s.createdAt, s.id), s);
    },
    async getRank(mode, day, score) {
      const keys = await listKeys(scores, scorePrefix(mode, day));
      const inv = String(INV - Math.min(score, INV)).padStart(7, '0');
      // Keys with a strictly smaller inverted-score segment are better runs.
      const prefixLen = scorePrefix(mode, day).length;
      return keys.filter((k) => k.slice(prefixLen).split('-')[0] < inv).length + 1;
    },
    async getLeaderboard(mode, day, limit) {
      const keys = (await listKeys(scores, scorePrefix(mode, day))).slice(0, limit);
      const rows = await Promise.all(keys.map((k) => scores.get(k, { type: 'json' })));
      return rows.filter(Boolean).map((s) => ({
        replayId: s.id, name: s.name, score: s.score,
        bestStreak: s.bestStreak, createdAt: s.createdAt,
      }));
    },
    async putReplay(id, data) {
      await replays.setJSON(id, data);
    },
    async getReplay(id) {
      return (await replays.get(id, { type: 'json' })) ?? null;
    },
    async getContribCache(key) {
      return (await contrib.get(key, { type: 'json' })) ?? null;
    },
    async setContribCache(key, payload, fetchedAt) {
      await contrib.setJSON(key, { payload, fetchedAt });
    },
    async getDailySecret() {
      const existing = await meta.get('daily_secret', { type: 'text' });
      if (existing) return existing;
      const secret = randomBytes(32).toString('hex');
      await meta.set('daily_secret', secret);
      return secret;
    },
  };
}

// Housekeeping for the scheduled cleanup function: drop stale sessions and
// keep replays only for scores that can still appear on a leaderboard.
const SESSION_TTL_MS = 24 * 3600 * 1000;
const REPLAYS_KEPT_PER_BOARD = 100;

export async function cleanupBlobStore() {
  const sessions = getStore({ name: 'snake-sessions' });
  const scores = getStore({ name: 'snake-scores' });
  const replays = getStore({ name: 'snake-replays' });
  const summary = { sessionsDeleted: 0, scoresTrimmed: 0, replaysDeleted: 0 };

  // 1. Sessions (and their claim markers) older than the TTL.
  const { blobs: sessionBlobs } = await sessions.list();
  for (const { key } of sessionBlobs) {
    if (key.endsWith('/used')) continue; // handled with its session
    const s = await sessions.get(key, { type: 'json' });
    if (s && Date.now() - s.createdAt > SESSION_TTL_MS) {
      await sessions.delete(key);
      await sessions.delete(`${key}/used`);
      summary.sessionsDeleted++;
    }
  }

  // 2. Per board (mode/day prefix), keep the top N scores; drop the rest
  //    along with their replays. Keys sort best-first by construction.
  const { blobs: scoreBlobs } = await scores.list();
  const byBoard = new Map();
  for (const { key } of scoreBlobs) {
    const prefix = key.split('/').slice(0, 2).join('/');
    if (!byBoard.has(prefix)) byBoard.set(prefix, []);
    byBoard.get(prefix).push(key);
  }
  for (const keys of byBoard.values()) {
    keys.sort();
    for (const key of keys.slice(REPLAYS_KEPT_PER_BOARD)) {
      const id = key.split('/')[2].split('-').slice(2).join('-');
      await scores.delete(key);
      await replays.delete(id);
      summary.scoresTrimmed++;
      summary.replaysDeleted++;
    }
  }

  return summary;
}

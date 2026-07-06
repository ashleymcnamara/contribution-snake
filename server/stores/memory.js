// In-memory store for tests. Mirrors the store interface exactly.
import { randomBytes } from 'node:crypto';

export function createMemoryStore() {
  const sessions = new Map();
  const scores = [];
  const replays = new Map();
  const contribCache = new Map();
  const dailyClaims = new Set();
  let dailySecret = null;

  const matches = (s, mode, day) => s.mode === mode && (s.day ?? null) === (day ?? null);

  return {
    async getSession(id) {
      const s = sessions.get(id);
      return s ? { ...s } : null;
    },
    async createSession(session) {
      sessions.set(session.id, { ...session });
    },
    // Atomic within a single JS runtime: synchronous check-and-set.
    async claimSession(id) {
      const s = sessions.get(id);
      if (!s || s.used) return false;
      s.used = true;
      return true;
    },
    // One ranked daily score per client per day: first claim wins.
    async claimDailyRank(day, clientId) {
      const key = `${day}/${clientId}`;
      if (dailyClaims.has(key)) return false;
      dailyClaims.add(key);
      return true;
    },
    async insertScore(score) {
      scores.push({ ...score });
    },
    async getRank(mode, day, score) {
      return scores.filter((s) => matches(s, mode, day) && s.score > score).length + 1;
    },
    async getLeaderboard(mode, day, limit) {
      return scores
        .filter((s) => matches(s, mode, day))
        .sort((a, b) => b.score - a.score || a.createdAt - b.createdAt)
        .slice(0, limit)
        .map((s) => ({
          replayId: s.id, name: s.name, score: s.score,
          bestStreak: s.bestStreak, createdAt: s.createdAt,
        }));
    },
    async putReplay(id, data) {
      replays.set(id, structuredClone(data));
    },
    async getReplay(id) {
      return replays.get(id) ?? null;
    },
    async getContribCache(key) {
      return contribCache.get(key) ?? null;
    },
    async setContribCache(key, payload, fetchedAt) {
      contribCache.set(key, { payload: structuredClone(payload), fetchedAt });
    },
    async getDailySecret() {
      if (!dailySecret) dailySecret = randomBytes(32).toString('hex');
      return dailySecret;
    },
  };
}

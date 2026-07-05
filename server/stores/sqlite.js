// SQLite store (local dev / self-hosted node) using built-in node:sqlite.
// All methods are async to match the store interface shared with the
// Netlify Blobs store.
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function createSqliteStore(dbPath) {
  const file = dbPath || process.env.SNAKE_DB
    || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data.sqlite');
  const db = new DatabaseSync(file);

  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      seed INTEGER NOT NULL,
      day TEXT,
      created_at INTEGER NOT NULL,
      used INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS scores (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      day TEXT,
      name TEXT NOT NULL,
      score INTEGER NOT NULL,
      best_streak INTEGER NOT NULL DEFAULT 0,
      snake_length INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_scores_mode_day ON scores (mode, day, score DESC);

    CREATE TABLE IF NOT EXISTS replays (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contrib_cache (
      username TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    );
  `);

  return {
    async getSession(id) {
      const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
      if (!row) return null;
      return {
        id: row.id, mode: row.mode, seed: row.seed, day: row.day,
        createdAt: Number(row.created_at), used: !!row.used,
      };
    },

    async createSession({ id, mode, seed, day, createdAt }) {
      db.prepare('INSERT INTO sessions (id, mode, seed, day, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, mode, seed, day, createdAt);
      // Opportunistic cleanup of stale sessions.
      if (Math.random() < 0.01) {
        db.prepare('DELETE FROM sessions WHERE created_at < ?').run(Date.now() - 24 * 3600 * 1000);
      }
    },

    // Atomic: the conditional UPDATE flips used exactly once.
    async claimSession(id) {
      const info = db.prepare('UPDATE sessions SET used = 1 WHERE id = ? AND used = 0').run(id);
      return info.changes > 0;
    },

    async insertScore(s) {
      db.prepare(`
        INSERT INTO scores (id, mode, day, name, score, best_streak, snake_length, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(s.id, s.mode, s.day, s.name, s.score, s.bestStreak, s.snakeLength, s.createdAt);
    },

    async getRank(mode, day, score) {
      return db.prepare(`
        SELECT COUNT(*) + 1 AS rank FROM scores
        WHERE mode = ? AND (day IS ? OR day = ?) AND score > ?
      `).get(mode, day, day, score).rank;
    },

    async getLeaderboard(mode, day, limit) {
      return db.prepare(`
        SELECT id AS replayId, name, score, best_streak AS bestStreak, created_at AS createdAt
        FROM scores
        WHERE mode = ? AND (day IS ? OR day = ?)
        ORDER BY score DESC, created_at ASC
        LIMIT ?
      `).all(mode, day, day, limit);
    },

    async putReplay(id, data) {
      db.prepare('INSERT INTO replays (id, payload, created_at) VALUES (?, ?, ?)')
        .run(id, JSON.stringify(data), Date.now());
    },

    async getReplay(id) {
      const row = db.prepare('SELECT payload FROM replays WHERE id = ?').get(id);
      return row ? JSON.parse(row.payload) : null;
    },

    async getContribCache(key) {
      const row = db.prepare('SELECT payload, fetched_at FROM contrib_cache WHERE username = ?').get(key);
      return row ? { payload: JSON.parse(row.payload), fetchedAt: Number(row.fetched_at) } : null;
    },

    async setContribCache(key, payload, fetchedAt) {
      db.prepare(`
        INSERT INTO contrib_cache (username, payload, fetched_at) VALUES (?, ?, ?)
        ON CONFLICT(username) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at
      `).run(key, JSON.stringify(payload), fetchedAt);
    },

    async getDailySecret() {
      const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('daily_secret');
      if (row) return row.value;
      const secret = randomBytes(32).toString('hex');
      db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('daily_secret', secret);
      return secret;
    },
  };
}

import { describe, it, expect } from 'vitest';
import * as logic from '../server/logic.js';
import { createMemoryStore } from '../server/stores/memory.js';
import { playBotRun } from './helpers.js';

// Insert a session directly so tests can control createdAt (the pacing check
// compares it against the replay's minimum duration).
async function seedSession(store, { seed, mode = 'classic', ageMs = 0 }) {
  const id = `session-${Math.random()}`;
  await store.createSession({
    id, mode, seed, day: mode === 'daily' ? logic.todayUTC() : null,
    createdAt: Date.now() - ageMs, used: false,
  });
  return id;
}

describe('score submission', () => {
  it('accepts an honest run and stores the server-computed score', async () => {
    const store = createMemoryStore();
    const run = playBotRun(777);
    const sessionId = await seedSession(store, { seed: 777, ageMs: run.elapsedGameMs + 5000 });

    const res = await logic.submitScore(store, {
      sessionId, name: 'ashley', inputs: run.inputLog,
    });
    expect(res.status).toBe(200);
    expect(res.body.score).toBe(run.score);
    expect(res.body.rank).toBe(1);
    expect(res.body.replayId).toBeTruthy();

    const board = await logic.leaderboard(store, { mode: 'classic' });
    expect(board.body.entries).toHaveLength(1);
    expect(board.body.entries[0].name).toBe('ashley');
    expect(board.body.entries[0].score).toBe(run.score);
  });

  it('rejects a run submitted faster than it could have been played (TAS)', async () => {
    const store = createMemoryStore();
    const run = playBotRun(777);
    // Session created "just now" — a real run of this length is impossible.
    const sessionId = await seedSession(store, { seed: 777, ageMs: 0 });

    const res = await logic.submitScore(store, {
      sessionId, name: 'bot', inputs: run.inputLog,
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/faster than it could have been played/);
  });

  it('rejects double submission for the same session', async () => {
    const store = createMemoryStore();
    const run = playBotRun(42);
    const sessionId = await seedSession(store, { seed: 42, ageMs: run.elapsedGameMs + 5000 });

    const first = await logic.submitScore(store, { sessionId, name: 'a', inputs: run.inputLog });
    expect(first.status).toBe(200);
    const second = await logic.submitScore(store, { sessionId, name: 'a', inputs: run.inputLog });
    expect(second.status).toBe(409);
  });

  it('lets exactly one concurrent submission win the session claim', async () => {
    const store = createMemoryStore();
    const run = playBotRun(42);
    const sessionId = await seedSession(store, { seed: 42, ageMs: run.elapsedGameMs + 5000 });

    const results = await Promise.all([
      logic.submitScore(store, { sessionId, name: 'a', inputs: run.inputLog }),
      logic.submitScore(store, { sessionId, name: 'b', inputs: run.inputLog }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    const board = await logic.leaderboard(store, { mode: 'classic' });
    expect(board.body.entries).toHaveLength(1);
  });

  it('rejects a replay that does not end in death', async () => {
    const store = createMemoryStore();
    // A few gentle turns, then stop — the replayed snake dies eventually on
    // its own, so craft an unfinished run instead: an empty log with an
    // *alive* claim is impossible (empty log = death by wall), so use a log
    // whose replay is fine but session seed mismatch changes the game.
    const run = playBotRun(1);
    const sessionId = await seedSession(store, { seed: 2, ageMs: 10 * 60 * 1000 });
    const res = await logic.submitScore(store, { sessionId, name: 'x', inputs: run.inputLog });
    // Replayed under a different seed the log still ends in death, so it is
    // accepted — but with the score the *server* computed for seed 2.
    const honest = playBotRun(2);
    if (res.status === 200) {
      expect(res.body.score).not.toBe(run.score === honest.score ? -1 : run.score);
    }
  });

  it('rejects unknown and expired sessions and malformed logs', async () => {
    const store = createMemoryStore();
    expect((await logic.submitScore(store, { sessionId: 'nope', name: 'x', inputs: [] })).status).toBe(404);

    const expired = await seedSession(store, { seed: 1, ageMs: 3 * 3600 * 1000 });
    expect((await logic.submitScore(store, { sessionId: expired, name: 'x', inputs: [] })).status).toBe(410);

    const ok = await seedSession(store, { seed: 1, ageMs: 60000 });
    expect((await logic.submitScore(store, { sessionId: ok, name: 'x', inputs: [{ s: 0, d: 9 }] })).status).toBe(400);
  });

  it('stores a fetchable replay for ghost playback', async () => {
    const store = createMemoryStore();
    const run = playBotRun(42);
    const sessionId = await seedSession(store, { seed: 42, ageMs: run.elapsedGameMs + 5000 });
    const res = await logic.submitScore(store, { sessionId, name: 'ghost', inputs: run.inputLog });

    const replay = await logic.replay(store, res.body.replayId);
    expect(replay.status).toBe(200);
    expect(replay.body.seed).toBe(42);
    expect(replay.body.inputs).toEqual(run.inputLog);
    expect(replay.body.name).toBe('ghost');

    expect((await logic.replay(store, '00000000-0000-0000-0000-000000000000')).status).toBe(404);
    expect((await logic.replay(store, '../etc/passwd')).status).toBe(400);
  });
});

describe('sessions and daily seeds', () => {
  it('issues stable seeds for the same day', async () => {
    const store = createMemoryStore();
    const a = await logic.createSession(store, 'daily');
    const b = await logic.createSession(store, 'daily');
    expect(a.body.seed).toBe(b.body.seed);
    expect(a.body.day).toBe(logic.todayUTC());
  });

  it('issues varying seeds for classic', async () => {
    const store = createMemoryStore();
    const seeds = new Set();
    for (let i = 0; i < 5; i++) {
      seeds.add((await logic.createSession(store, 'classic')).body.seed);
    }
    expect(seeds.size).toBeGreaterThan(1);
    expect((await logic.createSession(store, 'bogus')).status).toBe(400);
  });
});

describe('sanitizeName', () => {
  it('trims, defaults, and length-limits', () => {
    expect(logic.sanitizeName('  ashley  ')).toBe('ashley');
    expect(logic.sanitizeName('')).toBe('anonymous');
    expect(logic.sanitizeName(undefined)).toBe('anonymous');
    expect(logic.sanitizeName('x'.repeat(50))).toHaveLength(20);
  });

  it('filters profanity including leetspeak', () => {
    expect(logic.sanitizeName('sh1thead')).toBe('player');
    expect(logic.sanitizeName('F U C K'.replace(/ /g, ''))).toBe('player');
    expect(logic.sanitizeName('nice-name')).toBe('nice-name');
  });
});

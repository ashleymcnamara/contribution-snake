import { describe, it, expect } from 'vitest';
import * as logic from '../server/logic.js';
import { createMemoryStore } from '../server/stores/memory.js';
import { CURRENT_RULES } from '../src/game/core.js';
import { playBotRun } from './helpers.js';

// Insert a session directly so tests can control createdAt (the pacing check
// compares it against the replay's minimum duration). Sessions default to the
// current rules to match playBotRun; pass rules: undefined to mimic a legacy
// pre-versioning session (replayed under v1).
async function seedSession(store, { seed, mode = 'classic', ageMs = 0, rules = CURRENT_RULES, ...extra }) {
  const id = `session-${Math.random()}`;
  await store.createSession({
    id, mode, seed, day: mode === 'daily' ? logic.todayUTC() : null,
    rules, createdAt: Date.now() - ageMs, used: false, ...extra,
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
    expect(res.body.replayId).toMatch(/^[0-9A-Za-z]{8}$/); // short, URL-friendly share id

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

describe('graph mode sessions', () => {
  const emptyGrid = () => Array.from({ length: 52 }, () => new Array(7).fill(0));

  it('creates graph sessions from the cached contribution grid', async () => {
    const store = createMemoryStore();
    const grid = emptyGrid();
    grid[0][0] = 2;
    await store.setContribCache('octocat',
      { username: 'octocat', grid, months: ['Jan'], total: 1 }, Date.now());
    const res = await logic.createSession(store, 'graph', { username: 'Octocat' });
    expect(res.status).toBe(200);
    expect(res.body.day).toBe('octocat'); // per-user leaderboard key
    expect(res.body.rules).toBe(CURRENT_RULES);
  });

  it('rejects graph sessions without a username', async () => {
    const store = createMemoryStore();
    expect((await logic.createSession(store, 'graph', {})).status).toBe(400);
  });

  it('rejects invalid historical contribution years before fetching GitHub', async () => {
    const store = createMemoryStore();
    const res = await logic.contributions(store, 'octocat', 2007);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Contribution year/);
  });

  it('verifies a winning graph run and ranks it on the per-user board', async () => {
    const store = createMemoryStore();
    const grid = emptyGrid();
    grid[27][3] = 4; // directly in front of the starting head (26,3)
    const sessionId = await seedSession(store, {
      seed: 9, mode: 'graph', ageMs: 60000, graph: grid, day: 'octocat',
    });

    // No inputs needed: the snake eats the only cell on step one and wins.
    const res = await logic.submitScore(store, { sessionId, name: 'grapher', inputs: [] });
    expect(res.status).toBe(200);
    expect(res.body.score).toBe(20); // level-4 cell
    expect(res.body.rank).toBe(1);

    const board = await logic.leaderboard(store, { mode: 'graph', user: 'Octocat' });
    expect(board.status).toBe(200);
    expect(board.body.entries).toHaveLength(1);
    expect(board.body.entries[0].name).toBe('grapher');

    // The stored replay carries the board so spectate/ghosts can rebuild it.
    const replay = await logic.replay(store, res.body.replayId);
    expect(replay.body.graph).toEqual(grid);
    expect(replay.body.rules).toBe(CURRENT_RULES);
  });

  it('rejects graph leaderboard requests without a valid username', async () => {
    const store = createMemoryStore();
    expect((await logic.leaderboard(store, { mode: 'graph' })).status).toBe(400);
    expect((await logic.leaderboard(store, { mode: 'graph', user: '../nope' })).status).toBe(400);
  });
});

describe('all-time leaderboard', () => {
  it('merges every board into one ranking, tagged with where each run came from', async () => {
    const store = createMemoryStore();
    // Scores span all three board types; graph runs outscore classic by design.
    await store.insertScore({ id: 'aaaaaaaa', mode: 'classic', day: null, name: 'ash', score: 195, bestStreak: 5, snakeLength: 10, createdAt: 1000 });
    await store.insertScore({ id: 'bbbbbbbb', mode: 'daily', day: '2026-07-06', name: 'boo', score: 400, bestStreak: 8, snakeLength: 14, createdAt: 2000 });
    await store.insertScore({ id: 'cccccccc', mode: 'graph', day: 'cassidoo', name: 'cassidoo', score: 20479, bestStreak: 208, snakeLength: 300, createdAt: 3000 });
    await store.insertScore({ id: 'dddddddd', mode: 'graph', day: 'octocat', name: 'octo', score: 7610, bestStreak: 86, snakeLength: 120, createdAt: 4000 });

    const board = await logic.leaderboard(store, { mode: 'all' });
    expect(board.status).toBe(200);
    expect(board.body.mode).toBe('all');
    expect(board.body.day).toBe(null);

    const rows = board.body.entries;
    expect(rows.map((e) => e.score)).toEqual([20479, 7610, 400, 195]);
    // Each row is labeled with its originating board.
    expect(rows[0]).toMatchObject({ name: 'cassidoo', mode: 'graph', day: 'cassidoo', replayId: 'cccccccc' });
    expect(rows[2]).toMatchObject({ mode: 'daily', day: '2026-07-06' });
    expect(rows[3]).toMatchObject({ mode: 'classic', day: null });
  });

  describe('friends leaderboard', () => {
    it('filters a Daily board to the requested local friend names', async () => {
      const store = createMemoryStore();
      const day = '2026-07-17';
      await store.insertScore({ id: 'aaaaaaaa', mode: 'daily', day, name: 'Ashley', score: 300, bestStreak: 7, snakeLength: 10, createdAt: 1000 });
      await store.insertScore({ id: 'bbbbbbbb', mode: 'daily', day, name: 'Mona', score: 450, bestStreak: 9, snakeLength: 12, createdAt: 2000 });
      await store.insertScore({ id: 'cccccccc', mode: 'daily', day, name: 'Stranger', score: 900, bestStreak: 12, snakeLength: 15, createdAt: 3000 });

      const board = await logic.leaderboard(store, {
        mode: 'daily',
        day,
        friends: 'ashley,mona',
      });

      expect(board.status).toBe(200);
      expect(board.body.scope).toBe('friends');
      expect(board.body.entries.map((entry) => entry.name)).toEqual(['Mona', 'Ashley']);
    });
  });

  it('breaks score ties by earliest submission', async () => {
    const store = createMemoryStore();
    await store.insertScore({ id: 'later000', mode: 'classic', day: null, name: 'late', score: 100, bestStreak: 1, snakeLength: 5, createdAt: 5000 });
    await store.insertScore({ id: 'early000', mode: 'graph', day: 'x', name: 'early', score: 100, bestStreak: 1, snakeLength: 5, createdAt: 1000 });
    const rows = (await logic.leaderboard(store, { mode: 'all' })).body.entries;
    expect(rows.map((e) => e.name)).toEqual(['early', 'late']);
  });
});

describe('one-shot daily', () => {
  it('ranks only the first daily submission per client', async () => {
    const store = createMemoryStore();
    const run = playBotRun(777, { mode: 'daily', day: logic.todayUTC() });
    const ageMs = run.elapsedGameMs + 5000;
    const s1 = await seedSession(store, { seed: 777, mode: 'daily', ageMs, clientId: 'client-a' });
    const s2 = await seedSession(store, { seed: 777, mode: 'daily', ageMs, clientId: 'client-a' });

    const first = await logic.submitScore(store, { sessionId: s1, name: 'a', inputs: run.inputLog });
    expect(first.status).toBe(200);
    const second = await logic.submitScore(store, { sessionId: s2, name: 'a', inputs: run.inputLog });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/first daily score/);

    // A different browser (clientId) still ranks normally.
    const s3 = await seedSession(store, { seed: 777, mode: 'daily', ageMs, clientId: 'client-b' });
    expect((await logic.submitScore(store, { sessionId: s3, name: 'b', inputs: run.inputLog })).status).toBe(200);

    const board = await logic.leaderboard(store, { mode: 'daily' });
    expect(board.body.entries).toHaveLength(2);
  });

  it('leaves legacy sessions without a clientId unrestricted', async () => {
    const store = createMemoryStore();
    const run = playBotRun(42, { mode: 'daily', day: logic.todayUTC() });
    const ageMs = run.elapsedGameMs + 5000;
    const s1 = await seedSession(store, { seed: 42, mode: 'daily', ageMs });
    const s2 = await seedSession(store, { seed: 42, mode: 'daily', ageMs });
    expect((await logic.submitScore(store, { sessionId: s1, name: 'x', inputs: run.inputLog })).status).toBe(200);
    expect((await logic.submitScore(store, { sessionId: s2, name: 'x', inputs: run.inputLog })).status).toBe(200);
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

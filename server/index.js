// Express adapter for local dev and self-hosted node deployments. All real
// logic lives in logic.js (shared with the Netlify Functions adapter); this
// file only maps HTTP to handler calls against the SQLite store.
import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { createSqliteStore } from './stores/sqlite.js';
import * as logic from './logic.js';

const PORT = process.env.PORT || 3001;
const app = express();
const store = createSqliteStore();

app.use(express.json({ limit: '1mb' }));

// Naive per-IP rate limit — enough to stop casual abuse. (On Netlify this
// concern is handled per-function invocation instead.)
const hits = new Map();
app.use('/api/', (req, res, next) => {
  const now = Date.now();
  const rec = hits.get(req.ip) || { count: 0, reset: now + 60000 };
  if (now > rec.reset) { rec.count = 0; rec.reset = now + 60000; }
  rec.count++;
  hits.set(req.ip, rec);
  if (rec.count > 120) return res.status(429).json({ error: 'Slow down a little.' });
  next();
});

const send = (res, { status, body }) => res.status(status).json(body);
const wrap = (fn) => async (req, res) => {
  try {
    send(res, await fn(req));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal error.' });
  }
};

app.get('/api/health', wrap(() => logic.health()));
app.get('/api/contributions/:username', wrap((req) =>
  logic.contributions(store, req.params.username, req.query.year)));
app.post('/api/session', wrap((req) => logic.createSession(store, req.body?.mode, {
  username: req.body?.username, clientId: req.body?.clientId,
})));
app.post('/api/scores', wrap((req) => logic.submitScore(store, req.body || {})));
app.get('/api/leaderboard', wrap((req) => logic.leaderboard(store, req.query)));
app.get('/api/replay/:id', wrap((req) => logic.replay(store, req.params.id)));

app.get('/api/og/:file', async (req, res) => {
  try {
    const result = await logic.ogImage(store, req.params.file);
    if (result.buffer) {
      res.set('Content-Type', result.contentType);
      res.set('Cache-Control', 'public, max-age=86400, immutable');
      return res.send(result.buffer);
    }
    send(res, result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal error.' });
  }
});

app.get('/r/:id', async (req, res) => {
  try {
    const origin = `${req.protocol}://${req.get('host')}`;
    const { status, html } = await logic.sharePage(store, req.params.id, origin);
    res.status(status).type('html').send(html);
  } catch (err) {
    console.error(err);
    res.status(500).type('html').send('<p>Internal error.</p>');
  }
});

// In production, serve the built frontend from the same process.
const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
}

app.listen(PORT, () => {
  console.log(`snake server listening on http://localhost:${PORT}`
    + (process.env.GITHUB_TOKEN ? ' (GraphQL mode)' : ' (public scrape mode)'));
});

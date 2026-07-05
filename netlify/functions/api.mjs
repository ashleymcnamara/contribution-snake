// Netlify Functions adapter (Functions v2). Routes every /api/* endpoint
// through the shared logic in server/logic.js against the Blobs store.
import { createBlobStore } from '../../server/stores/blobs.js';
import * as logic from '../../server/logic.js';

const json = ({ status, body }) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export default async function handler(req, context) {
  const store = createBlobStore();
  const url = new URL(req.url);
  const { username, id } = context.params ?? {};

  try {
    if (url.pathname === '/api/health') {
      return json(logic.health());
    }
    if (username !== undefined) {
      return json(await logic.contributions(store, username));
    }
    if (url.pathname.startsWith('/api/og/')) {
      const result = await logic.ogImage(store, url.pathname.slice('/api/og/'.length));
      if (result.buffer) {
        return new Response(result.buffer, {
          headers: {
            'Content-Type': result.contentType,
            'Cache-Control': 'public, max-age=86400, immutable',
          },
        });
      }
      return json(result);
    }
    if (id !== undefined) {
      return json(await logic.replay(store, id));
    }
    if (url.pathname === '/api/session' && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      return json(await logic.createSession(store, body?.mode));
    }
    if (url.pathname === '/api/scores' && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      return json(await logic.submitScore(store, body));
    }
    if (url.pathname === '/api/leaderboard') {
      return json(await logic.leaderboard(store, {
        mode: url.searchParams.get('mode'),
        day: url.searchParams.get('day'),
      }));
    }
    return json({ status: 404, body: { error: 'Not found.' } });
  } catch (err) {
    console.error(err);
    return json({ status: 500, body: { error: 'Internal error.' } });
  }
}

export const config = {
  path: [
    '/api/health',
    '/api/session',
    '/api/scores',
    '/api/leaderboard',
    '/api/contributions/:username',
    '/api/replay/:id',
    '/api/og/:file',
  ],
};

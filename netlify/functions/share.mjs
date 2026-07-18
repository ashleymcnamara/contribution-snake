// Share pages at /r/<replayId>: OG meta for scrapers, instant redirect into
// spectate mode for humans.
import { createBlobStore } from '../../server/stores/blobs.js';
import { sharePage } from '../../server/logic.js';

export default async function handler(req, context) {
  const store = createBlobStore();
  const origin = new URL(req.url).origin;
  try {
    const { status, html, cacheControl } = await sharePage(store, context.params?.id, origin);
    return new Response(html, {
      status,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': cacheControl || 'no-store',
      },
    });
  } catch (err) {
    console.error(err);
    return new Response('<p>Internal error.</p>', {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}

export const config = {
  path: '/r/:id',
};

// Scheduled housekeeping: prune expired sessions and trim replays that can
// no longer appear on any leaderboard. Runs daily via Netlify's scheduler.
import { cleanupBlobStore } from '../../server/stores/blobs.js';

export default async function handler() {
  const summary = await cleanupBlobStore();
  console.log('cleanup:', JSON.stringify(summary));
  return new Response(JSON.stringify(summary), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export const config = {
  schedule: '@daily',
};

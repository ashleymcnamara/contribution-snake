// Thin client for the game server. Every call degrades gracefully: when the
// backend is unreachable (e.g. the static GitHub Pages deploy), the game
// falls back to offline classic mode and hides server-backed features.
const BASE = import.meta.env.VITE_API_BASE || '';

let serverAvailable = null;

async function req(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export async function checkServer() {
  if (serverAvailable !== null) return serverAvailable;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    await req('/api/health', { signal: controller.signal });
    clearTimeout(timer);
    serverAvailable = true;
  } catch {
    serverAvailable = false;
  }
  return serverAvailable;
}

export function getContributions(username) {
  return req(`/api/contributions/${encodeURIComponent(username)}`);
}

// Anonymous, stable per-browser token. Backs the daily challenge's
// first-score-counts rule; never identifies the player beyond this browser.
export function clientId() {
  let id = localStorage.getItem('gh-snake-client');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('gh-snake-client', id);
  }
  return id;
}

// username: graph mode only — the server fetches (and trusts) that grid.
export function createSession(mode, username) {
  return req('/api/session', {
    method: 'POST',
    body: JSON.stringify({ mode, username, clientId: clientId() }),
  });
}

export function submitScore(sessionId, name, inputs) {
  return req('/api/scores', {
    method: 'POST',
    body: JSON.stringify({ sessionId, name, inputs }),
  });
}

// Graph leaderboards are per-username: pass user instead of day.
export function getLeaderboard(mode, day, user) {
  const params = new URLSearchParams({ mode });
  if (day) params.set('day', day);
  if (user) params.set('user', user);
  return req(`/api/leaderboard?${params}`);
}

export function getReplay(id) {
  return req(`/api/replay/${encodeURIComponent(id)}`);
}

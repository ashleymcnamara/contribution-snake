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

export function createSession(mode) {
  return req('/api/session', { method: 'POST', body: JSON.stringify({ mode }) });
}

export function submitScore(sessionId, name, inputs) {
  return req('/api/scores', {
    method: 'POST',
    body: JSON.stringify({ sessionId, name, inputs }),
  });
}

export function getLeaderboard(mode, day) {
  const q = day ? `?mode=${mode}&day=${day}` : `?mode=${mode}`;
  return req(`/api/leaderboard${q}`);
}

export function getReplay(id) {
  return req(`/api/replay/${encodeURIComponent(id)}`);
}

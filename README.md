# Contribution Snake

A snake game themed around the GitHub contribution graph — now with a backend. Eat commits on a classic board, race everyone on the **daily challenge**, or type in a GitHub username and **play a real contribution graph**: committed days are the food, weighted by intensity.

## Play

**[Play the live version](https://yetanothersnake.dev)**

Run the full stack locally:

```bash
npm install
npm run dev          # frontend (5173) + game server (3001) together
```

Open http://localhost:5173. The frontend also works standalone (`npm run dev:web`) — without the server it falls back to offline classic mode and hides the daily challenge, graph mode, and leaderboard. It's still an installable PWA and plays offline.

`npm test` runs the Vitest suite (deterministic core, replay validation, anti-cheat, contribution normalization); `npm run test:e2e` runs a Playwright smoke test through the real game (play, die, submit, watch the replay). CI runs both on every push and PR.

## Deploying

**Netlify (primary):** connect the repo and deploy — `netlify.toml` handles everything. The API runs as a Netlify Function (`netlify/functions/api.mjs`) and stores sessions, scores, and replays in **Netlify Blobs**, so there is no database to provision. `npx netlify dev` runs the same setup locally.

**Any node host (alternative):** `npm run build && npm start` serves the built frontend and the API from one process, storing data in SQLite.

Both adapters are thin shells around the same [server/logic.js](server/logic.js); pick either without code changes.

### Optional: GitHub token

Without configuration the server reads contribution calendars from GitHub's public HTML calendar. Set `GITHUB_TOKEN` (no scopes needed) to use the official GraphQL API instead — more reliable and includes exact totals.

## Game modes

| Mode | Board | Leaderboard |
|------|-------|-------------|
| **Classic** | Random food, endless, speeds up per level | Global, all-time |
| **Daily challenge** | Same seeded board for everyone, resets at UTC midnight — race today's #1 as a translucent **ghost** | Per-day |
| **Your graph** | A real user's last 12 months, 52×7. Brighter days are worth more. Eat the whole year to win. | — (scores aren't comparable) |

Two unranked variants — **wrap walls** and **chill speed** — can be toggled on the start screen for classic and graph modes. Variant runs never create a server session, so they can't touch the leaderboard by construction.

Click any leaderboard entry to **watch that run** — the server stores the input log of every verified score, and the client plays it back through the same deterministic core. A bot plays an attract-mode demo behind the start screen (disabled under reduced motion), and a local stats panel tracks your games, averages, and daily-challenge streak. **Unlockable achievements** reward milestones — your first game, a 100-point run, a 50-streak, clearing a whole graph, a 14-day daily streak — and pop a toast the moment you earn them.

Game-over screens have one-tap sharing to X, Bluesky, and Threads (plus the native share sheet with the card image attached, where supported). Graph-mode shares deep-link to `?user=<name>`, so whoever clicks lands ready to play that exact graph; daily shares link to `?daily=1`.

Verified runs get a **share page** at `/r/<id>` whose link preview is a server-rendered image of that exact final board (drawn with a hand-built pixel font — no native deps, no font files), and which drops visitors straight into watching the replay. Your own best run per mode is kept locally and re-watchable from the start screen.

## Controls

| Input | Action |
|-------|--------|
| `↑` `↓` `←` `→` or `WASD` | Move |
| Swipe on the board or D-pad | Move (touch) |
| `Space`, the pause button, or a tap on the board | Pause / resume |

## Anti-cheat: replay-validated scores

Scores are never trusted from the client. Instead:

1. The server issues a **session** with a random seed (`POST /api/session`).
2. The game core is fully deterministic — seeded RNG, tick-based streak timing, no wall-clock — and records an input log (`{step, direction}` pairs).
3. On submit, the server **replays the input log** through the same core (`src/game/core.js` is shared between browser and Node) and stores the score *it* computed, not the one the client claims.
4. A **pacing check** compares the session's age against the replay's minimum possible duration (the sum of its tick intervals) — an input log searched offline and submitted seconds later is rejected, because it arrives faster than it could have been played.

Forging a score would require finding an input sequence that plays that well *and* waiting it out in real time — which is just playing well.

## API

| Endpoint | Purpose |
|----------|---------|
| `GET /api/contributions/:username` | Normalized 52×7 contribution grid (cached 10 min) |
| `POST /api/session` | Issue a seeded game session (`classic` \| `daily`) |
| `POST /api/scores` | Submit `{sessionId, name, inputs}` for replay verification |
| `GET /api/leaderboard?mode=&day=` | Top 20 verified scores |
| `GET /api/replay/:id` | Input log of a verified run, for ghosts and spectating |
| `GET /api/og/:id.png` | Server-rendered link-preview image of a run's final board |
| `GET /r/:id` | Share page: OG meta for scrapers, replay redirect for humans |

## Frontend

Vite + vanilla JS modules, canvas rendering. Interpolated movement with a connected snake body, a visible combo-window meter, particles, screen shake, a WebAudio synth (no audio files), dark/light themes matching GitHub's palettes plus a colorblind-safe blue/orange palette (mirroring GitHub's own colorblind option), shareable 1200×630 game-over cards with your rank, auto-pause on tab switch, unlockable achievements, a 3-2-1 resume countdown, haptic feedback on touch devices, PWA/offline support, reduced-motion and screen-reader friendly. All icons are inline SVG.

```
src/
  game/core.js        deterministic game logic (shared with the server)
  game/rng.js         seeded PRNG
  render/renderer.js  canvas drawing, interpolation, ghosts, effects
  main.js             game loop, modes, spectating, UI wiring
  achievements.js     unlockable milestones (pure logic, local storage)
  audio.js  theme.js  api.js  share.js  icons.js
server/
  logic.js            all API behavior (adapter- and storage-agnostic)
  github.js           contribution fetcher (GraphQL or public-page fallback)
  stores/             sqlite.js · blobs.js (Netlify) · memory.js (tests)
  index.js            Express adapter
netlify/functions/
  api.mjs             Netlify Functions adapter
tests/                Vitest suite for the core and the API logic
```


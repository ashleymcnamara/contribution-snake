# GitSnake

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
| **Daily challenge** | Same seeded board for everyone, resets at UTC midnight — and it's a **crowd race**: the whole top-10's replays run alongside you as a translucent field, a live position pill tracks where you sit ("P4 · 11 racers"), the nearest run still ahead of you is spotlit and named, and the game-over screen says where you finished. **One-shot**: only your first submitted score ranks; later runs are practice. | Per-day |
| **Your graph** | A real user's last 12 months, 52×7. Brighter days are worth more, and the pace ramps up as you clear the board. Eat the whole year to win. | Per-username — everyone playing the same graph competes |

In classic and daily, every fifth commit spawns a **golden commit** — a timed bonus cell worth 50 base points (the streak multiplier applies) that blinks out after ~4.5 seconds of play at the speed it spawned at (time-normalized so top-level goldens aren't unwinnable). Detour or not: that's the decision. And the head may slide into the cell the tail is vacating (**tail forgiveness**), so tight coils no longer end in deaths that feel stolen.

Three unranked variants — **wrap walls**, **chill speed**, and **rotten commits** (a timed hazard cell every third eat that zeroes your streak and costs 25 points) — can be toggled on the start screen for classic and graph modes. Variant runs never create a server session, so they can't touch the leaderboard by construction. A fourth toggle, **race your best**, replays your best local run as a translucent ghost: daily and graph boards match by construction, while classic reuses that run's exact board and plays unranked. On today's daily leaderboard, every entry also has a **race** button — pick any rival, not just #1 — and the game-over screen renders a verdict on who won.

Click any leaderboard entry to **watch that run** — the server stores the input log of every verified score, and the client plays it back through the same deterministic core, with a 1×/2×/4× speed toggle and a click-to-seek progress bar (seeking just re-simulates from step zero). A bot plays an attract-mode demo behind the start screen (disabled under reduced motion), and a local stats panel tracks your games, averages, and daily-challenge streak. **Unlockable achievements** reward milestones — your first game, a 100-point run, a 50-streak, clearing a whole graph, a 14-day daily streak — and pop a toast the moment you earn them.

Game-over screens have one-tap sharing to X, Bluesky, and Threads (plus the native share sheet with the card image attached, where supported). Graph-mode shares deep-link to `?user=<name>`, so whoever clicks lands ready to play that exact graph; daily shares link to `?daily=1`.

Verified runs get a **share page** at `/r/<id>` whose link preview is a server-rendered image of that exact final board (drawn with a hand-built pixel font — no native deps, no font files), and which drops visitors straight into watching the replay. Your own best run per mode is kept locally and re-watchable from the start screen.

## Controls

| Input | Action |
|-------|--------|
| `↑` `↓` `←` `→` or `WASD` | Move (also skips the 3-2-1 countdown) |
| Swipe on the board or D-pad | Move (touch; swipes register mid-gesture, and one drag can chain turns) |
| `Space`, the pause button, or a tap on the board | Pause / resume |
| `R` | Instant rematch from the game-over screen |

## Anti-cheat: replay-validated scores

Scores are never trusted from the client. Instead:

1. The server issues a **session** with a random seed (`POST /api/session`).
2. The game core is fully deterministic — seeded RNG, tick-based streak timing, no wall-clock — and records an input log (`{step, direction}` pairs).
3. On submit, the server **replays the input log** through the same core (`src/game/core.js` is shared between browser and Node) and stores the score *it* computed, not the one the client claims.
4. A **pacing check** compares the session's age against the replay's minimum possible duration (the sum of its tick intervals) — an input log searched offline and submitted seconds later is rejected, because it arrives faster than it could have been played.

Forging a score would require finding an input sequence that plays that well *and* waiting it out in real time — which is just playing well.

Gameplay changes that alter determinism bump a **rules version** (`CURRENT_RULES` in the core). Every session, stored replay, and local best run records the rules it was played under, and replays always run under their recorded version — so old ghosts, share links, and leaderboard entries keep replaying to their original outcome. Graph sessions store the server-fetched grid, so a graph score is validated against the same board it claims to have been played on. The daily's one-shot rule is keyed to an anonymous per-browser token — clearing site data resets it, which is fine: it keeps the day honest for everyone playing normally, not against determined adversaries.

## API

| Endpoint | Purpose |
|----------|---------|
| `GET /api/contributions/:username` | Normalized 52×7 contribution grid (cached 10 min) |
| `POST /api/session` | Issue a seeded game session (`classic` \| `daily` \| `graph` — graph takes a `username`, daily a `clientId` for the one-shot rule) |
| `POST /api/scores` | Submit `{sessionId, name, inputs}` for replay verification |
| `GET /api/leaderboard?mode=&day=&user=` | Top 20 verified scores (`user` selects a graph board) |
| `GET /api/replay/:id` | Input log of a verified run, for ghosts and spectating |
| `GET /api/og/:id.png` | Server-rendered link-preview image of a run's final board |
| `GET /r/:id` | Share page: OG meta for scrapers, replay redirect for humans |

## Frontend

Vite + vanilla JS modules, canvas rendering. Interpolated movement with a connected snake body, a visible combo-window meter, particles, screen shake, a WebAudio synth (no audio files), dark/light/auto themes matching GitHub's palettes plus a colorblind-safe blue/orange palette (mirroring GitHub's own colorblind option), shareable 1200×630 game-over cards with your rank, auto-pause on tab switch, unlockable achievements with progress bars toward locked ones, an install nudge when the browser allows it, a skippable 3-2-1 countdown before every run and on resume, haptic feedback on touch devices, PWA/offline support, reduced-motion and screen-reader friendly. The game-over screen names what killed you, celebrates new personal bests, previews where an unsubmitted score would rank, and graph runs show days-eaten progress in the HUD. On phones, the 52-column graph board switches to a **follow-camera** — full-size cells in a viewport that tracks the snake's head — instead of shrinking into illegibility. While watching any replay, an **Export clip** button records the playback to a downloadable WebM video, re-simulated offscreen so the visible playback never stutters (`canvas.captureStream()` + `MediaRecorder`, no dependencies). All icons are inline SVG.

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


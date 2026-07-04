# 🐍 GitHub Snake

A snake game themed around the GitHub contribution graph. The snake is made of contribution squares that fade from bright to dark green as they trail behind — just like your commit activity.

Built as a demo. Single HTML file, no dependencies, no build step.

## Play

**[▶ Play the live version](https://ashleymcnamara.github.io/contribution-snake/)**

Or run it locally — open `index.html` in any browser, or serve it:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

It's an installable PWA: on a served version you can "Add to Home Screen" / install it, and it plays offline.

## Controls

| Input | Action |
|-----|--------|
| `↑` `↓` `←` `→` or `WASD` | Move |
| Swipe on the board | Move (touch) |
| `Space`, the ⏸ button, or a tap on the board | Pause / resume |

Touch controls (a D-pad plus swipe) appear automatically on mobile.

## How it works

- **Eat commits** (the pulsing green square) to grow your snake and rack up contributions
- **Build streaks** — eat food quickly to increase your multiplier (+10, +15, +20...)
- **Level up** every 50 points — the game speeds up as you go
- **Don't break the build** — hitting a wall or yourself ends the game

## Features

- Contribution graph grid with day/month labels
- Snake segments colored by contribution intensity (brighter = newer)
- Score popups and particle effects on food pickup
- Death flash animation with red particle burst
- Streak tracking and multiplier system (streaks survive pausing)
- High score saved to localStorage and shown on the start screen
- Responsive canvas that scales to fit any screen, crisp on high-DPI displays
- Mobile support: on-screen D-pad, swipe to steer, tap to pause
- Respects `prefers-reduced-motion` (no particles, strobe, or pulsing)
- Installable PWA with offline support via a service worker
- Fully self-contained — one HTML file, zero runtime dependencies

## Built with

HTML canvas, vanilla JS, and the GitHub color palette. That's it.

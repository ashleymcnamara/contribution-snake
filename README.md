# 🐍 GitHub Snake

A snake game themed around the GitHub contribution graph. The snake is made of contribution squares that fade from bright to dark green as they trail behind — just like your commit activity.

Built as a demo. Single HTML file, no dependencies, no build step.

## Play

Open `index.html` in any browser, or serve it locally:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Controls

| Key | Action |
|-----|--------|
| `↑` `↓` `←` `→` or `WASD` | Move |
| `Space` | Pause |

Touch controls appear automatically on mobile.

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
- Streak tracking and multiplier system
- High score saved to localStorage
- Mobile touch controls
- Fully self-contained — one HTML file, zero dependencies

## Built with

HTML canvas, vanilla JS, and the GitHub color palette. That's it.

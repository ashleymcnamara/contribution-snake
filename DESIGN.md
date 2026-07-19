---
name: GitSnake
description: A living GitHub contribution graph shaped into a playful, replayable snake game.
colors:
  contribution-green: "#39d353"
  contribution-green-deep: "#238636"
  contribution-green-hover: "#2ea043"
  contribution-green-light: "#1a7f37"
  contribution-level-1: "#0e4429"
  contribution-level-2: "#006d32"
  contribution-level-3: "#26a641"
  canvas-black: "#0d1117"
  graph-surface: "#161b22"
  graph-border: "#30363d"
  ink-light: "#e6edf3"
  ink-muted-dark: "#8b949e"
  canvas-white: "#ffffff"
  graph-surface-light: "#f6f8fa"
  graph-border-light: "#d0d7de"
  ink-dark: "#1f2328"
  ink-muted-light: "#57606a"
  commit-gold: "#e3b341"
  power-purple: "#a371f7"
  focus-blue: "#58a6ff"
  colorblind-blue: "#79c0ff"
  danger-coral: "#ff7b72"
  danger-orange: "#db6d28"
  blush-pink: "#f778ba"
typography:
  display:
    fontFamily: "Mona Sans, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "28px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.2
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.3
rounded:
  cell: "2px"
  compact: "4px"
  control: "6px"
  container: "8px"
  pill: "999px"
spacing:
  hairline: "4px"
  compact: "8px"
  control: "12px"
  rhythm: "14px"
  section: "16px"
  roomy: "20px"
components:
  button-primary:
    backgroundColor: "{colors.contribution-green-deep}"
    textColor: "{colors.canvas-white}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "8px 20px"
  button-primary-hover:
    backgroundColor: "{colors.contribution-green-hover}"
    textColor: "{colors.canvas-white}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "8px 20px"
  button-secondary:
    backgroundColor: "{colors.graph-surface}"
    textColor: "{colors.ink-light}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "8px 20px"
  icon-button:
    backgroundColor: "{colors.graph-surface}"
    textColor: "{colors.ink-light}"
    rounded: "{rounded.control}"
    size: "30px"
  input:
    backgroundColor: "{colors.graph-surface}"
    textColor: "{colors.ink-light}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  status-pill:
    backgroundColor: "{colors.graph-surface}"
    textColor: "{colors.ink-muted-dark}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
---

# Design System: GitSnake

## Overview

**Creative North Star: "The Living Contribution Graph"**

GitSnake should feel as though the familiar GitHub contribution calendar woke up, grew a face, and invited the player in. The board is the visual protagonist; menus, controls, progress, and social features form a compact frame around it. The system borrows GitHub's density, contribution palette, and restrained component language without becoming a literal GitHub clone.

The interface is playful through behavior rather than decoration. The snake's expression, commit cells, game feedback, Git-native vocabulary, and moments of celebration carry personality. Product chrome stays polished, quiet, and immediately familiar so a player never has to decode the UI before playing.

Generic AI-generated SaaS dashboard patterns are prohibited. GitSnake never reaches for interchangeable card grids, decorative metrics, glass panels, gratuitous gradients, enterprise copy, overstimulating arcade clutter, or novelty-terminal cosplay.

**Key Characteristics:**

- The contribution graph is always the strongest visual element.
- Controls are compact, familiar, and quietly tactile.
- Information density is high but hierarchy remains immediate.
- Green indicates contribution activity, primary action, progress, or success—not decoration.
- Responsive behavior protects playable board scale before preserving ornamental layout.
- Motion communicates eating, danger, progress, pause, unlocks, and state changes.

## Colors

The palette is GitHub-native and state-driven: Canvas Black and tonal graph surfaces frame a four-step Contribution Green ramp, while Commit Gold and semantic accents appear only for meaningful events.

### Primary

- **Contribution Green:** The brightest contribution cell, snake head, progress, selected state, and successful outcome.
- **Contribution Green Deep:** Primary button fill in dark mode; confident without competing with the live board.
- **Contribution Green Hover:** The single brighter action state for primary controls.
- **Contribution Green Light:** The accessible primary action and selection color on light surfaces.
- **Contribution Levels 1–3:** The body and contribution-density ramp. Preserve order and perceptual progression.

### Secondary

- **Colorblind Blue:** Replaces the green contribution ramp when the colorblind palette is active. It retains the same hierarchy and gameplay meaning.
- **Focus Blue:** Reserved for keyboard focus outlines. Never repurpose it as decorative accent.

### Tertiary

- **Commit Gold:** Golden commits, bonus feedback, and earned rarity.
- **Power Purple:** Active Fork status and power-up feedback.
- **Blush Pink:** Character expression only.
- **Danger Coral / Danger Orange:** Collision, hazard, and destructive feedback. Orange replaces coral in the colorblind palette.

### Neutral

- **Canvas Black / Canvas White:** Root dark and light backgrounds.
- **Graph Surface / Graph Surface Light:** Board chrome, secondary controls, overlays, and bounded utility regions.
- **Graph Border / Graph Border Light:** One-pixel separation without visual lift.
- **Ink Light / Ink Dark:** Primary text.
- **Ink Muted Dark / Ink Muted Light:** Secondary labels and explanatory copy; verify WCAG 2.2 AA at every use.

**The Contribution Signal Rule.** Contribution Green is functional. If a green element does not represent action, progress, contribution density, selection, or success, remove the green.

**The Meaning Survives Color Rule.** Every state represented by color must also have shape, position, text, iconography, or motion support.

## Typography

**Display Font:** Mona Sans (with the system sans stack)

**Body Font:** The native system sans stack

**Character:** Mona Sans gives the GitSnake wordmark and countdown a compact, friendly confidence. The system stack keeps gameplay labels, stats, menus, and forms fast, familiar, and platform-native.

### Hierarchy

- **Display** (800, 28px, 1): Brand wordmark and rare game-scale moments.
- **Headline** (700, 28px, 1.2): Overlay titles such as Game Over, Locker, and Leaderboard.
- **Title** (700, 14px, 1.3): Card names, achievement names, and high-value labels.
- **Body** (400, 14px, 1.5): Explanations, buttons, form copy, and game-over verdicts.
- **Label** (500, 12px, 1.3): HUD labels, compact metadata, mode notes, and status pills.

**The Gameplay Type Rule.** Typography must never become louder than the board during active play. Large display type is reserved for the brand, countdown, and terminal states.

**The Stable Number Rule.** Scores, streaks, levels, ranks, and progress always use tabular numerals and reserved widths where layout could otherwise pulse.

## Elevation

GitSnake is flat and tonal by default. Depth comes from background steps, one-pixel borders, overlap, and state—not permanent floating cards. The board uses a near-invisible outline for crispness. Shadows are reserved for transient feedback such as achievement toasts and the oversized countdown.

### Shadow Vocabulary

- **Board Outline** (`0 0 0 1px rgba(240, 246, 252, 0.04)`): A crisp edge on the canvas wrapper in dark mode.
- **Toast Lift** (`0 6px 24px rgba(0, 0, 0, 0.28)`): Temporary achievement and unlock feedback above the game.
- **Countdown Glow** (`0 2px 24px rgba(0, 0, 0, 0.45)`): Keeps the countdown readable over any board state.

**The Flat-at-Rest Rule.** Persistent surfaces never use ambient drop shadows. If a menu starts to look like a stack of dashboard cards, flatten it and restore hierarchy through spacing and tonal contrast.

## Components

Components are compact, familiar, and quietly tactile. Six- to eight-pixel rounding keeps controls friendly while the two-pixel contribution cells remain distinctly graph-like.

### Buttons

- **Shape:** Compact rounded rectangle (6px radius).
- **Primary:** Contribution Green Deep with white text and 8px × 20px padding. One primary action per decision point.
- **Hover / Focus:** Hover shifts to Contribution Green Hover. Keyboard focus uses a 2px Focus Blue outline with 2px offset. Active feedback scales to 97%; icon controls scale to 90%.
- **Secondary:** Graph Surface with Ink text and a one-pixel Graph Border. Hover uses the border tone as fill.
- **Ghost:** Linklike actions use muted text, no container, and Contribution Green only on hover or focus.

### Chips

- **Style:** Status pills use a tonal Graph Surface, one-pixel border, 999px radius, 12px type, and 2px × 10px padding.
- **State:** Green text/border indicates a leading or successful state. Power-up status may use its mechanic color but must retain a text label.

### Cards / Containers

- **Corner Style:** Gently curved containers (8px radius); the main board wrapper and compact utility panels use 6px.
- **Background:** Graph Surface or its light equivalent.
- **Shadow Strategy:** Flat at rest; see Elevation.
- **Border:** One-pixel Graph Border.
- **Internal Padding:** 8–12px for selectable items; 16–20px for aggregate panels.
- **Use:** Cards exist only for independently selectable or inspectable items such as campaign levels, cosmetics, and achievements. Never wrap a card in another card.

### Inputs / Fields

- **Style:** Graph Surface fill, one-pixel Graph Border, 6px radius, and 8px × 12px padding.
- **Focus:** A 2px Focus Blue inset outline.
- **Error / Disabled:** Error copy must be explicit and adjacent. Disabled controls reduce emphasis but retain readable labels.
- **Mobile:** Text fields remain at 16px to prevent iOS focus zoom.

### Navigation

- The GitSnake logo is the persistent home action.
- Mode selection uses one primary choice and restrained secondary choices in a narrow vertical rhythm.
- Secondary destinations form one stable text-action row: Leaderboard, Progress, and Locker. Progress groups local stats, achievements, and the best replay.
- Leaderboard scopes use familiar segmented buttons with an explicit selected state.

### Contribution Board

- The board is the signature component and visual center of gravity.
- Contribution cells retain a 2px radius and four-step density ramp.
- The snake, food, golden commits, hazards, walls, power-ups, ghosts, and focus camera all preserve board readability.
- Menus may cover the board between runs, but live HUD and brief text must never obscure playable cells.

### Overlay

- Full-viewport overlays provide start, pause, results, progression, and standings states.
- The background uses a high-opacity Canvas tone with only a subtle 2px blur; this is functional separation, not decorative glass.
- Content centers when short and top-aligns naturally when it needs to scroll.

## Do's and Don'ts

### Do:

- **Do** let the contribution board remain the strongest visual element on every gameplay screen.
- **Do** use Contribution Green only for action, progress, contribution density, selection, or success.
- **Do** preserve 2px Focus Blue outlines, complete keyboard operation, reduced-motion alternatives, and colorblind-safe semantics.
- **Do** reveal campaign, social, progression, and variant depth progressively instead of crowding the first decision.
- **Do** use compact 6px controls, 8px selectable containers, one-pixel borders, and tonal layering consistently.
- **Do** make Git metaphors explain mechanics or reward the player.

### Don't:

- **Don't** resemble a generic AI-generated SaaS dashboard: no interchangeable card grids, decorative metrics, glass panels, gratuitous gradients, or enterprise-product language.
- **Don't** introduce overstimulating arcade clutter, novelty-terminal cosplay, or a literal reproduction of GitHub's interface.
- **Don't** use a colored side-stripe border on cards, list items, callouts, alerts, or toasts.
- **Don't** add gradient text, decorative glassmorphism, ambient shadows on persistent surfaces, or green decoration without state meaning.
- **Don't** nest cards or turn every menu option into an identical icon-heading-description tile.
- **Don't** let large type, helper copy, HUD pills, or overlays compete with or cover the playable graph.
- **Don't** rely on color alone for power-ups, rank, completion, hazards, locked state, or contribution intensity.

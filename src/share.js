// Game-over share card: a 1200x630 PNG (OG-image sized) with the final board
// and run stats, drawn on an offscreen canvas.
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

function drawBoard(ctx, game, theme, x, y, maxW, maxH) {
  const gap = 3;
  const cell = Math.min(
    Math.floor((maxW - gap * game.cols) / game.cols),
    Math.floor((maxH - gap * game.rows) / game.rows)
  );
  const step = cell + gap;
  const w = game.cols * step - gap;
  const ox = x + (maxW - w) / 2;

  const snakeCells = new Map();
  game.snake.forEach((seg, i) => {
    const ratio = 1 - i / game.snake.length;
    const lvl = Math.min(3, Math.floor(ratio * 4));
    snakeCells.set(`${seg.x},${seg.y}`, i === 0 ? theme.head : theme.levels[lvl]);
  });

  for (let cx = 0; cx < game.cols; cx++) {
    for (let cy = 0; cy < game.rows; cy++) {
      const key = `${cx},${cy}`;
      let fill = theme.empty;
      if (game.mode === 'graph') {
        const lvl = game.cells.get(key);
        if (lvl) fill = theme.levels[lvl - 1];
      }
      if (snakeCells.has(key)) fill = snakeCells.get(key);
      else if (game.food && game.food.x === cx && game.food.y === cy) fill = theme.food;
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.roundRect(ox + cx * step, y + cy * step, cell, cell, 2);
      ctx.fill();
    }
  }
}

// Canonical social-card dimensions (OG-image sized) and the box the board is
// laid out in. Shared so the static PNG and the animated WebM clip frame the
// board identically.
export const CARD_W = 1200;
export const CARD_H = 630;
export const CARD_BOARD = { x: 64, y: 300, w: CARD_W - 128, h: CARD_H - 300 - 56 };

// The run's headline numbers. The level slot gives way to golden commits when
// any were eaten (more interesting, and keeps the row from overflowing the
// card). Reused live by the clip recorder so the stats tick up as it plays.
export function runStats(game) {
  return [
    [String(game.score), 'contributions'],
    [String(game.bestStreak), 'best streak'],
    [String(game.snake.length), 'snake length'],
    game.goldenEaten > 0
      ? [String(game.goldenEaten), 'golden commits']
      : [String(game.level), 'level'],
  ];
}

// Brand header, stat row, and footer tagline — the parts of the card that wrap
// the board. Drawn in the caller's current transform; the caller paints the
// background and the board itself. Shared by the static PNG and the WebM clip.
export function drawCardChrome(ctx, { theme, title = 'GitSnake', subtitle = '', stats = [], footer = null }) {
  ctx.fillStyle = theme.text;
  ctx.font = `bold 44px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(title, 64, 52);
  if (subtitle) {
    ctx.font = `26px ${FONT}`;
    ctx.fillStyle = theme.textMuted;
    ctx.fillText(subtitle, 66, 112);
  }

  let sx = 64;
  for (const [value, label] of stats) {
    ctx.fillStyle = theme.accent;
    ctx.font = `bold 56px ${FONT}`;
    ctx.fillText(value, sx, 170);
    ctx.fillStyle = theme.textMuted;
    ctx.font = `22px ${FONT}`;
    ctx.fillText(label, sx, 236);
    sx += Math.max(ctx.measureText(label).width, ctx.measureText(value).width) + 200;
  }

  if (footer) {
    ctx.fillStyle = theme.textMuted;
    ctx.font = `20px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(footer, CARD_W - 64, CARD_H - 44);
  }
}

export function buildShareCard({ game, theme, modeLabel, username }) {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  drawCardChrome(ctx, {
    theme,
    subtitle: username ? `${modeLabel} · @${username}` : modeLabel,
    stats: runStats(game),
    footer: game.won ? 'Ate the whole year.' : 'Don’t break the build.',
  });

  drawBoard(ctx, game, theme, CARD_BOARD.x, CARD_BOARD.y, CARD_BOARD.w, CARD_BOARD.h);

  return canvas;
}

export async function downloadCard(canvas, filename = 'gitsnake-run.png') {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Canonical URL for a run — graph mode deep-links to the username so a
// shared link opens ready to play that exact graph.
export function gameUrl({ mode, username }) {
  const base = location.origin + location.pathname;
  if (mode === 'graph' && username) return `${base}?user=${encodeURIComponent(username)}`;
  if (mode === 'daily') return `${base}?daily=1`;
  return base;
}

// Web intents carry text (+ url) only — images ride along via nativeShare.
export function shareLinks(text, url) {
  const combined = encodeURIComponent(`${text}\n${url}`);
  return {
    x: `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
    bluesky: `https://bsky.app/intent/compose?text=${combined}`,
    threads: `https://www.threads.net/intent/post?text=${combined}`,
  };
}

// Native share sheet (mostly mobile) — attaches the card PNG when the
// platform supports file sharing. Returns false so callers can fall back.
export async function nativeShare({ text, url, canvas }) {
  if (!navigator.share) return false;
  const data = { text, url };
  try {
    if (canvas && navigator.canShare) {
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      if (blob) {
        const file = new File([blob], 'gitsnake.png', { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) data.files = [file];
      }
    }
    await navigator.share(data);
    return true;
  } catch {
    return false; // cancelled or unsupported combination
  }
}

export function shareText({ game, mode, day, rank, username }) {
  const rankTag = rank ? ` · #${rank}${mode === 'daily' ? ' today' : ''}` : '';
  if (mode === 'daily') {
    return `GitSnake Daily ${day} — ${game.score} contributions, ${game.bestStreak} best streak${rankTag}`;
  }
  if (mode === 'graph') {
    const pct = game.totalCells
      ? Math.round(((game.totalCells - game.cells.size) / game.totalCells) * 100)
      : 0;
    const who = username ? `@${username}'s year of GitHub contributions` : 'a year of GitHub contributions';
    return game.won
      ? `I ate all of ${who} — ${game.score} points. Think you can too?`
      : `I ate ${pct}% of ${who} — ${game.score} points. Think you can beat that?`;
  }
  return `GitSnake — ${game.score} contributions, ${game.bestStreak} best streak${rankTag}`;
}

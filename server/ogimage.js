// Server-rendered OG image (1200x630 PNG) for a verified run: the final
// board plus stats in a 5x7 pixel font. Pure JS (pngjs) — no native deps,
// no font files — so it runs unmodified in Netlify Functions and Node.
import { PNG } from 'pngjs';

const W = 1200;
const H = 630;

// Dark theme palette (the brand look for link previews).
const C = {
  bg: [13, 17, 23],
  empty: [22, 27, 34],
  text: [230, 237, 243],
  muted: [139, 148, 158],
  accent: [57, 211, 83],
  levels: [[14, 68, 41], [0, 109, 50], [38, 166, 65], [57, 211, 83]],
  food: [57, 211, 83],
};

// 5x7 pixel font — each glyph is 7 rows of 5 bits, MSB = left column.
const FONT = {
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  B: [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
  C: [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
  D: [0b11100, 0b10010, 0b10001, 0b10001, 0b10001, 0b10010, 0b11100],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  F: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
  G: [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01111],
  H: [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  I: [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  J: [0b00111, 0b00010, 0b00010, 0b00010, 0b00010, 0b10010, 0b01100],
  K: [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
  L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  M: [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
  N: [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
  O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  Q: [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  S: [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  U: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  V: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  W: [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001],
  X: [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
  Y: [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
  Z: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
  0: [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  1: [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  2: [0b01110, 0b10001, 0b00001, 0b00110, 0b01000, 0b10000, 0b11111],
  3: [0b11111, 0b00010, 0b00100, 0b00010, 0b00001, 0b10001, 0b01110],
  4: [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  5: [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  6: [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  7: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  8: [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  9: [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '-': [0, 0, 0, 0b01110, 0, 0, 0],
  '.': [0, 0, 0, 0, 0, 0b00110, 0b00110],
  '#': [0b01010, 0b01010, 0b11111, 0b01010, 0b11111, 0b01010, 0b01010],
  '@': [0b01110, 0b10001, 0b10111, 0b10101, 0b10111, 0b10000, 0b01110],
  "'": [0b00100, 0b00100, 0, 0, 0, 0, 0],
};

function px(png, x, y, [r, g, b]) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (W * y + x) << 2;
  png.data[i] = r;
  png.data[i + 1] = g;
  png.data[i + 2] = b;
  png.data[i + 3] = 255;
}

function rect(png, x, y, w, h, color) {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) px(png, x + dx, y + dy, color);
  }
}

function drawText(png, text, x, y, scale, color) {
  let cx = x;
  for (const raw of String(text).toUpperCase()) {
    const glyph = FONT[raw] ?? FONT[' '];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (glyph[row] & (1 << (4 - col))) {
          rect(png, cx + col * scale, y + row * scale, scale, scale, color);
        }
      }
    }
    cx += 6 * scale; // 5px glyph + 1px spacing
  }
  return cx;
}

function textWidth(text, scale) {
  return String(text).length * 6 * scale;
}

function segmentColor(index, total) {
  if (index === 0) return C.accent;
  const ratio = 1 - index / total;
  return C.levels[Math.min(3, Math.floor(ratio * 4))];
}

// final: a finished GameState from replayGame.
export function renderOgImage({ final, name, score, mode, day }) {
  const png = new PNG({ width: W, height: H });
  rect(png, 0, 0, W, H, C.bg);

  drawText(png, 'GITHUB SNAKE', 60, 48, 5, C.text);
  const nameEnd = drawText(png, name, 60, 108, 4, C.accent);
  drawText(png, ` - ${score} PTS`, nameEnd, 108, 4, C.text);
  const modeLine = mode === 'daily' ? `DAILY ${day}` : 'CLASSIC';
  drawText(png, `${modeLine}   BEST STREAK ${final.bestStreak}`, 60, 158, 3, C.muted);

  // Final board, centered under the header (ends above the footer line).
  const cell = 14;
  const gap = 3;
  const step = cell + gap;
  const bw = final.cols * step - gap;
  const bx = Math.floor((W - bw) / 2);
  const by = 212;

  for (let x = 0; x < final.cols; x++) {
    for (let y = 0; y < final.rows; y++) {
      rect(png, bx + x * step, by + y * step, cell, cell, C.empty);
    }
  }
  if (final.food) {
    rect(png, bx + final.food.x * step, by + final.food.y * step, cell, cell, C.food);
  }
  final.snake.forEach((seg, i) => {
    rect(png, bx + seg.x * step, by + seg.y * step, cell, cell,
      segmentColor(i, final.snake.length));
  });

  const footer = "DON'T BREAK THE BUILD.";
  drawText(png, footer, W - 60 - textWidth(footer, 2), H - 26, 2, C.muted);

  return PNG.sync.write(png);
}

// Static homepage preview (public/og-image.png) — same look as the per-run
// cards so every link from the site matches. `staged` is a live mid-game
// state (see scripts/generate-og.mjs).
export function renderHomeOgImage(staged) {
  const png = new PNG({ width: W, height: H });
  rect(png, 0, 0, W, H, C.bg);

  drawText(png, 'GITHUB SNAKE', 60, 48, 5, C.text);
  drawText(png, 'EAT COMMITS. GROW YOUR STREAK.', 60, 112, 3, C.accent);
  drawText(png, 'PLAY YOUR REAL CONTRIBUTION GRAPH. RACE THE DAILY.', 60, 158, 2, C.muted);

  const cell = 14;
  const gap = 3;
  const step = cell + gap;
  const bw = staged.cols * step - gap;
  const bx = Math.floor((W - bw) / 2);
  const by = 212;
  for (let x = 0; x < staged.cols; x++) {
    for (let y = 0; y < staged.rows; y++) {
      rect(png, bx + x * step, by + y * step, cell, cell, C.empty);
    }
  }
  if (staged.food) {
    rect(png, bx + staged.food.x * step, by + staged.food.y * step, cell, cell, C.food);
  }
  staged.snake.forEach((seg, i) => {
    rect(png, bx + seg.x * step, by + seg.y * step, cell, cell,
      segmentColor(i, staged.snake.length));
  });

  const footer = 'YETANOTHERSNAKE.DEV';
  drawText(png, footer, W - 60 - textWidth(footer, 2), H - 26, 2, C.muted);

  return PNG.sync.write(png);
}

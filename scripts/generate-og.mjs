// Regenerates public/og-image.png (the homepage link preview) with the same
// pixel renderer used for per-run share cards. Run: node scripts/generate-og.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createGame, step } from '../src/game/core.js';
import { botSteer } from '../src/game/bot.js';
import { renderHomeOgImage } from '../server/ogimage.js';

// Stage a healthy mid-game board: let the bot eat its way to a long snake,
// then stop while it is still alive. Fixed seed keeps the image reproducible.
const game = createGame({ mode: 'classic', seed: 20260704 });
while (game.alive && game.snake.length < 18 && game.stepCount < 4000) {
  botSteer(game);
  step(game);
}
if (!game.alive) throw new Error('Bot died before staging the board — pick another seed.');

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'og-image.png');
writeFileSync(out, renderHomeOgImage(game));
console.log(`wrote ${out} (snake length ${game.snake.length}, score ${game.score})`);

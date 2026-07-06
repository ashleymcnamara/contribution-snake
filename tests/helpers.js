import { createGame, queueInput, step } from '../src/game/core.js';

// Play a seeded game with a greedy bot that chases the food. Returns the
// finished (dead) game state, including its input log — a realistic stand-in
// for a human run in tests. Runs under the current rules unless told otherwise.
export function playBotRun(seed, { mode = 'classic', maxSteps = 5000, rules } = {}) {
  const game = createGame({ mode, seed, ...(rules ? { rules } : {}) });
  while (game.alive && game.stepCount < maxSteps) {
    const h = game.snake[0];
    const f = game.food;
    let want = null;
    if (f.x > h.x) want = 1;
    else if (f.x < h.x) want = 3;
    else if (f.y > h.y) want = 2;
    else if (f.y < h.y) want = 0;
    if (want !== null && want !== game.dir) queueInput(game, want);
    step(game);
  }
  return game;
}

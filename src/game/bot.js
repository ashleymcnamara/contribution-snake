// Greedy demo bot: chases the food but refuses obviously fatal moves.
// Used by the attract mode, the OG-image generator, and tests. Deterministic
// given the game state — no randomness of its own.
import { DIRS, queueInput } from './core.js';

function wouldDie(state, d) {
  const dir = DIRS[d];
  let x = state.snake[0].x + dir.x;
  let y = state.snake[0].y + dir.y;
  if (x < 0 || x >= state.cols || y < 0 || y >= state.rows) {
    if (!state.wrap) return true;
    x = (x + state.cols) % state.cols;
    y = (y + state.rows) % state.rows;
  }
  // The tail cell vacates this step unless the snake eats, but staying
  // conservative here just makes the bot a little more cautious.
  return state.snake.some((s) => s.x === x && s.y === y);
}

// Queue one steering decision for the upcoming step (unlogged).
export function botSteer(state) {
  const h = state.snake[0];
  let target = state.food;
  if (state.mode === 'graph' && state.cells?.size) {
    // Nearest remaining contribution cell.
    let bestDist = Infinity;
    for (const key of state.cells.keys()) {
      const [x, y] = key.split(',').map(Number);
      const dist = Math.abs(x - h.x) + Math.abs(y - h.y);
      if (dist < bestDist) { bestDist = dist; target = { x, y }; }
    }
  }
  if (!target) return;

  const preferred = [];
  if (target.x > h.x) preferred.push(1);
  if (target.x < h.x) preferred.push(3);
  if (target.y > h.y) preferred.push(2);
  if (target.y < h.y) preferred.push(0);
  preferred.push(0, 1, 2, 3); // fall back to any survivable direction

  for (const d of preferred) {
    if (d === state.dir && !wouldDie(state, d)) return; // keep going straight
    if (!wouldDie(state, d) && queueInput(state, d, false)) return;
  }
}

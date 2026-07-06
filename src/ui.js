// Presentation helpers: the modal overlay, the transient toast + screen-reader
// announcements, the touch d-pad toggle, and the 3-2-1 countdown. These own no
// game state — anything they need (the renderer, the live game, month labels,
// ghosts) is read from the shared ctx passed in by main.
import { updateRaceStrip } from './race.js';
import { fitBoard, draw } from './render/renderer.js';
import * as audio from './audio.js';

const $ = (id) => document.getElementById(id);

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function announce(msg) {
  $('a11y-status').textContent = msg;
}

// Short vibration on supported touch devices. Patterns are deliberately tiny so
// frequent events (eating) stay pleasant rather than buzzy.
export function haptic(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

// Transient corner toast (used for achievement unlocks). Also mirrored to the
// screen-reader live region by the caller via announce().
export function toast(icon, title, sub) {
  const stack = $('toast-stack');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML =
    `<span class="toast-icon" aria-hidden="true">${icon}</span>` +
    `<span class="toast-text"><strong>${escapeHtml(title)}</strong>` +
    (sub ? `<span>${escapeHtml(sub)}</span>` : '') + `</span>`;
  stack.appendChild(el);
  // Trigger the enter transition on the next frame.
  requestAnimationFrame(() => el.classList.add('show'));
  const remove = () => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  };
  setTimeout(remove, 4200);
  el.addEventListener('click', remove);
}

// --- overlay management ---
const OVERLAY_SECTIONS = ['mode-buttons', 'user-row', 'btn-leaderboard', 'btn-watch-shared',
  'btn-watch-best', 'btn-stats', 'btn-achievements', 'btn-install', 'stats-panel', 'stats-back',
  'achievements-panel', 'achievements-back', 'btn-resume', 'submit-row',
  'over-actions', 'share-row', 'lb-tabs', 'leaderboard', 'over-stats'];

export function showOverlay(ctx, title, sub, sections = []) {
  clearCountdown(); // cancel any pending resume countdown if we navigate away
  updateRaceStrip(null); // the live position pill only makes sense mid-run
  $('overlay-title').textContent = title;
  $('overlay-sub').textContent = sub;
  for (const id of OVERLAY_SECTIONS) $(id).hidden = !sections.includes(id);
  $('overlay').style.display = 'flex';
  // The touch d-pad is only useful during active play — keep it out of the way
  // (and out of the layout, so the board can reclaim the space) on every menu,
  // game-over, leaderboard and pause screen.
  setTouchControls(ctx, false);
  // Move focus with the content so keyboard / screen-reader users aren't
  // stranded on a control that just became hidden (focus would fall to <body>
  // and reading position would jump back to the top of the page).
  $('overlay-title').focus({ preventScroll: true });
}

export function hideOverlay() {
  $('overlay').style.display = 'none';
}

// Show/hide the on-screen d-pad and re-fit the board to the space that leaves.
// It stays hidden on non-touch devices via the (pointer: coarse) media query.
export function setTouchControls(ctx, show) {
  $('touch-controls').hidden = !show;
  if (ctx.renderer.cols) fitBoard(ctx.renderer);
}

// --- countdown ---
let countdownTimers = [];
let countdownDone = null; // pending completion — lets input skip the 3-2-1
export function clearCountdown() {
  countdownTimers.forEach(clearTimeout);
  countdownTimers = [];
  countdownDone = null;
  $('countdown').hidden = true;
}

// A direction key or board tap cuts the countdown short — after the first few
// games the 3-2-1 is ritual, not information. Returns true if it skipped.
export function skipCountdown() {
  if (!countdownDone) return false;
  const done = countdownDone;
  clearCountdown();
  done();
  return true;
}

export function runCountdown(ctx, done) {
  clearCountdown();
  countdownDone = done;
  const el = $('countdown');
  const steps = ['3', '2', '1'];
  el.hidden = false;
  const show = (i) => {
    if (i >= steps.length) {
      skipCountdown(); // natural finish: same path as a manual skip
      return;
    }
    el.textContent = steps[i];
    el.classList.remove('tick');
    void el.offsetWidth; // restart the CSS pop animation
    el.classList.add('tick');
    audio.playClick();
    if (ctx.game) draw(ctx.renderer, ctx.game, null, 1, { monthLabels: ctx.monthLabels, ghosts: ctx.ghosts });
    countdownTimers.push(setTimeout(() => show(i + 1), 500));
  };
  show(0);
}

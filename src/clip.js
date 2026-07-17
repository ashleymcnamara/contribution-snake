// Replay → WebM export. Re-simulates a watched run in an offscreen renderer and
// records that canvas with MediaRecorder, so the on-screen playback is never
// touched. No new dependencies: captureStream + MediaRecorder are the whole
// implementation, both feature-detected by clipSupported() before the export
// button is ever shown.
import { createGame, queueInput, step, boardSize } from './game/core.js';
import {
  createRenderer, sizeToCard, draw, clearEffects,
  spawnParticles, spawnFloatingText,
} from './render/renderer.js';
import { drawCardChrome, runStats, CARD_W, CARD_H, CARD_BOARD } from './share.js';

// Preferred first; MediaRecorder.isTypeSupported picks the first the browser can
// actually encode (vp9 → vp8 → whatever its default webm is).
const MIME_TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

function isTypeSupported(type) {
  try { return MediaRecorder.isTypeSupported(type); } catch { return false; }
}

// Both APIs are missing on some older Safari builds; when unsupported the caller
// hides the export button entirely rather than offering a dead action.
export function clipSupported() {
  if (typeof MediaRecorder === 'undefined') return false;
  if (typeof HTMLCanvasElement === 'undefined' ||
      typeof HTMLCanvasElement.prototype.captureStream !== 'function') return false;
  return MIME_TYPES.some(isTypeSupported);
}

// Mirror main's per-frame catch-up clamp so a slow frame can't teleport the
// snake several cells in the recording (see MAX_STEPS_PER_FRAME in main.js).
const MAX_STEPS_PER_FRAME = 2;

// Re-simulate { params, inputs } from step 0 at `speed`× real time, drawing
// every animation frame interpolated (same look as live playback), while
// MediaRecorder captures the offscreen canvas. Because MediaRecorder records
// wall-clock, a 2× replay finishes in half the run's real duration. Returns
// { promise, cancel }: promise resolves { cancelled } once the file downloads
// or recording is aborted; cancel() stops an in-flight recording without saving.
export function recordClip({
  params, inputs, months = null, theme, reduceMotion = false, speed = 2,
  cosmetics = null, caption = {}, onProgress = null,
}) {
  const canvas = document.createElement('canvas'); // never added to the layout
  const renderer = createRenderer(canvas);
  const { cols, rows } = boardSize(params.mode);
  // Render into a fixed 1200×630 social card (matching the static share PNG)
  // with the board centered and live run stats up top, so a shared clip embeds
  // as a proper landscape card instead of a bare board strip.
  const chrome = (cx, game) => drawCardChrome(cx, {
    theme,
    title: caption.title || 'GitSnake',
    subtitle: caption.subtitle || '',
    stats: runStats(game),
    footer: game.won ? 'Ate the whole year.' : 'Don’t break the build.',
  });
  sizeToCard(renderer, cols, rows, { width: CARD_W, height: CARD_H, box: CARD_BOARD, chrome });
  renderer.theme = theme;
  renderer.cosmetics = cosmetics;
  renderer.reduceMotion = reduceMotion;
  clearEffects(renderer);

  const game = createGame(params);
  let ptr = 0;
  const lastStep = inputs.length ? inputs[inputs.length - 1].s : 0;
  let prevSnake = null;
  let accumulator = 0;
  let last = performance.now();
  let raf = 0;
  let cancelled = false;
  let finished = false;

  const mimeType = MIME_TYPES.find(isTypeSupported) || '';
  const stream = canvas.captureStream(); // frames flow as we draw the canvas
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

  let resolveDone, rejectDone;
  const promise = new Promise((res, rej) => { resolveDone = res; rejectDone = rej; });

  function stopTracks() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    for (const track of stream.getTracks()) track.stop();
  }

  recorder.onerror = (e) => { stopTracks(); rejectDone(e.error || new Error('Recording failed')); };
  recorder.onstop = () => {
    stopTracks();
    if (cancelled || !chunks.length) { resolveDone({ cancelled: true }); return; }
    const blob = new Blob(chunks, { type: mimeType.split(';')[0] || 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gitsnake-run.webm';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000); // mirror share.js downloadCard
    resolveDone({ cancelled: false });
  };

  const progress = () => (lastStep ? Math.min(1, game.stepCount / lastStep) : 1);

  function frame(now) {
    if (cancelled) return;
    const dt = Math.min(250, now - last);
    last = now;
    accumulator += dt * speed;

    let steps = 0;
    const maxSteps = MAX_STEPS_PER_FRAME * speed;
    while (accumulator >= game.speed && game.alive && !game.won && steps < maxSteps) {
      prevSnake = game.snake.map((s) => ({ ...s }));
      while (ptr < inputs.length && inputs[ptr].s === game.stepCount) {
        queueInput(game, inputs[ptr].d, false);
        ptr++;
      }
      const ev = step(game);
      if (ev.ate) {
        spawnParticles(renderer, ev.head.x, ev.head.y, theme.food, 8);
        spawnFloatingText(renderer, ev.head.x, ev.head.y, `+${ev.points}`);
      }
      accumulator -= game.speed;
      steps++;
    }
    if (accumulator > game.speed) accumulator = game.speed;

    if (onProgress) onProgress(progress());

    if (!game.alive || game.won) {
      draw(renderer, game, null, 1, { monthLabels: months });
      finish();
      return;
    }
    const alpha = Math.min(1, accumulator / game.speed);
    draw(renderer, game, prevSnake, alpha, { monthLabels: months, showCombo: true });
    raf = requestAnimationFrame(frame);
  }

  // Hold the final frame briefly so the clip doesn't cut on the death frame,
  // then close the recording (onstop builds and downloads the file).
  function finish() {
    if (finished) return;
    finished = true;
    if (onProgress) onProgress(1);
    setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop(); }, 500);
  }

  recorder.start();
  raf = requestAnimationFrame(frame);

  return {
    promise,
    cancel() {
      if (cancelled) return;
      cancelled = true;
      if (recorder.state !== 'inactive') recorder.stop();
      else { stopTracks(); resolveDone({ cancelled: true }); }
    },
  };
}

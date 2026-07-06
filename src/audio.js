// Tiny WebAudio synth — no audio files. The context is created lazily on the
// first user gesture (autoplay policy) and everything degrades silently.
const STORAGE_KEY = 'gh-snake-muted';

let ctx = null;
let muted = localStorage.getItem(STORAGE_KEY) === '1';

// Must be called from inside a user gesture (tap/click/keydown). iOS Safari
// creates the context in a "suspended" state and only lets us resume it while
// a gesture is on the stack — resuming later (e.g. from the game loop) is
// silently rejected, which is why sound worked on desktop but not on mobile.
export function unlock() {
  if (muted) return;
  try {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      // Playing a one-sample silent buffer inside the gesture fully unlocks
      // audio output on iOS.
      const buf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  } catch {
    ctx = null;
  }
}

export function isMuted() {
  return muted;
}

export function toggleMute() {
  muted = !muted;
  localStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
  if (!muted) unlock();
  return muted;
}

function blip(freq, { type = 'square', dur = 0.08, vol = 0.04, when = 0, slide = 0 } = {}) {
  if (muted || !ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  const t = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

// Pitch rises with the streak so combos *sound* like combos.
export function playEat(streak) {
  blip(440 + Math.min(streak, 24) * 28, { type: 'square', dur: 0.07 });
}

export function playLevelUp() {
  blip(523, { type: 'triangle', dur: 0.09, vol: 0.05 });
  blip(659, { type: 'triangle', dur: 0.09, vol: 0.05, when: 0.09 });
  blip(784, { type: 'triangle', dur: 0.14, vol: 0.05, when: 0.18 });
}

export function playDeath() {
  blip(300, { type: 'sawtooth', dur: 0.35, vol: 0.05, slide: -240 });
  blip(150, { type: 'square', dur: 0.4, vol: 0.04, when: 0.05, slide: -110 });
}

export function playWin() {
  [523, 659, 784, 1047].forEach((f, i) =>
    blip(f, { type: 'triangle', dur: 0.12, vol: 0.05, when: i * 0.1 }));
}

export function playClick() {
  blip(700, { type: 'square', dur: 0.03, vol: 0.02 });
}

// Bright two-note "coin" flourish for the Rush golden pickup — distinct from
// the streak eat blip and the level-up climb so a golden reads instantly.
export function playGolden() {
  blip(988, { type: 'triangle', dur: 0.07, vol: 0.055 });
  blip(1319, { type: 'triangle', dur: 0.16, vol: 0.055, when: 0.07 });
}

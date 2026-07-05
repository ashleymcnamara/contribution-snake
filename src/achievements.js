// Achievements: unlocked milestones stored locally. Pure logic — no DOM, so it
// stays testable and the UI wiring lives in main.js. Each achievement's `test`
// receives { stats, run } where `stats` is the lifetime stats object (already
// updated for the just-finished run) and `run` describes that run.
import { achIcons } from './icons.js';

const KEY = 'gh-snake-achievements';

// Achievements whose thresholds were raised in the "harder achievements" update.
// Existing players had these unlocked at the old, easier bars, so we clear them
// once (guarded by RESET_KEY) to make them re-earn the tougher versions. Bump
// RESET_TAG if the thresholds are ever re-tuned and another reset is wanted.
const RESET_KEY = 'gh-snake-achievements-reset';
const RESET_TAG = '2026-07-harder-v1';
const BUFFED_IDS = ['committed', 'on-fire', 'combo-chain', 'unbroken', 'daily-devotee'];

export const ACHIEVEMENTS = [
  { id: 'first-bite', icon: achIcons.firstBite, name: 'First Bite',
    desc: 'Play your first game.', test: (c) => c.stats.games >= 1 },
  { id: 'regular', icon: achIcons.regular, name: 'Regular',
    desc: 'Play 10 games.', test: (c) => c.stats.games >= 10 },
  { id: 'committed', icon: achIcons.committed, name: 'Committed',
    desc: 'Play 100 games.', test: (c) => c.stats.games >= 100 },
  { id: 'century', icon: achIcons.century, name: 'Century',
    desc: 'Score 100 in a single run.', test: (c) => c.stats.bestScore >= 100 },
  { id: 'on-fire', icon: achIcons.onFire, name: 'On Fire',
    desc: 'Score 400 in a single run.', test: (c) => c.stats.bestScore >= 400 },
  { id: 'combo-chain', icon: achIcons.comboChain, name: 'Combo Chain',
    desc: 'Reach a 20 streak in one run.', test: (c) => c.stats.bestStreak >= 20 },
  { id: 'unbroken', icon: achIcons.unbroken, name: 'Unbroken',
    desc: 'Reach a 50 streak in one run.', test: (c) => c.stats.bestStreak >= 50 },
  { id: 'full-year', icon: achIcons.fullYear, name: 'Full Year',
    desc: 'Clear an entire contribution graph.', test: (c) => !!c.run.won && c.run.mode === 'graph' },
  { id: 'daily-devotee', icon: achIcons.dailyDevotee, name: 'Daily Devotee',
    desc: 'Keep a 14-day daily-challenge streak.', test: (c) => c.stats.dailyStreak >= 14 },
  { id: 'rule-bender', icon: achIcons.ruleBender, name: 'Rule Bender',
    desc: 'Finish a run with a variant turned on.', test: (c) => !!c.run.variant },
];

export function loadUnlocked() {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || '[]');
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

// One-time migration: clear the achievements whose thresholds were raised so
// they must be re-earned at the tougher bars. Guarded by RESET_KEY so it runs
// at most once per RESET_TAG. Returns the ids that were cleared. Call this once
// on startup, before rendering the achievements panel or evaluating a run.
export function reconcileUnlocked() {
  try {
    if (localStorage.getItem(RESET_KEY) === RESET_TAG) return [];
    // Set the guard first so a later save failure can't cause a re-clear loop.
    localStorage.setItem(RESET_KEY, RESET_TAG);
    const set = loadUnlocked();
    const cleared = [];
    for (const id of BUFFED_IDS) {
      if (set.has(id)) { set.delete(id); cleared.push(id); }
    }
    if (cleared.length) save(set);
    return cleared;
  } catch {
    return [];
  }
}

function save(set) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...set]));
  } catch { /* storage full / disabled — achievements are non-critical */ }
}

// Evaluate every achievement against the context, persist any new unlocks, and
// return the list of achievements unlocked *by this call* (for toasts).
export function evaluate(context) {
  const unlocked = loadUnlocked();
  const newly = [];
  for (const a of ACHIEVEMENTS) {
    if (unlocked.has(a.id)) continue;
    let ok = false;
    try { ok = a.test(context); } catch { ok = false; }
    if (ok) { unlocked.add(a.id); newly.push(a); }
  }
  if (newly.length) save(unlocked);
  return newly;
}

// Achievements: unlocked milestones stored locally. Pure logic — no DOM, so it
// stays testable and the UI wiring lives in main.js. Each achievement's `test`
// receives { stats, run } where `stats` is the lifetime stats object (already
// updated for the just-finished run) and `run` describes that run.
import { achIcons } from './icons.js';

const KEY = 'gh-snake-achievements';

export const ACHIEVEMENTS = [
  { id: 'first-bite', icon: achIcons.firstBite, name: 'First Bite',
    desc: 'Play your first game.', test: (c) => c.stats.games >= 1 },
  { id: 'regular', icon: achIcons.regular, name: 'Regular',
    desc: 'Play 10 games.', test: (c) => c.stats.games >= 10 },
  { id: 'committed', icon: achIcons.committed, name: 'Committed',
    desc: 'Play 50 games.', test: (c) => c.stats.games >= 50 },
  { id: 'century', icon: achIcons.century, name: 'Century',
    desc: 'Score 100 in a single run.', test: (c) => c.stats.bestScore >= 100 },
  { id: 'on-fire', icon: achIcons.onFire, name: 'On Fire',
    desc: 'Score 200 in a single run.', test: (c) => c.stats.bestScore >= 200 },
  { id: 'combo-chain', icon: achIcons.comboChain, name: 'Combo Chain',
    desc: 'Reach a 10 streak in one run.', test: (c) => c.stats.bestStreak >= 10 },
  { id: 'unbroken', icon: achIcons.unbroken, name: 'Unbroken',
    desc: 'Reach a 25 streak in one run.', test: (c) => c.stats.bestStreak >= 25 },
  { id: 'full-year', icon: achIcons.fullYear, name: 'Full Year',
    desc: 'Clear an entire contribution graph.', test: (c) => !!c.run.won && c.run.mode === 'graph' },
  { id: 'daily-devotee', icon: achIcons.dailyDevotee, name: 'Daily Devotee',
    desc: 'Keep a 7-day daily-challenge streak.', test: (c) => c.stats.dailyStreak >= 7 },
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

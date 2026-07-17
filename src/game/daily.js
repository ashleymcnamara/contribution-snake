export const DAILY_BRIEFS = [
  {
    id: 'hotfix',
    title: 'Hotfix',
    modifier: 'The board runs 15% faster, but every commit is worth 25% more.',
    objective: { kind: 'score', target: 250, label: 'Score 250 points' },
    speedFactor: 0.85,
    scoreFactor: 1.25,
  },
  {
    id: 'gold-rush',
    title: 'Gold Rush',
    modifier: 'Golden commits arrive more often and stay on the board a little longer.',
    objective: { kind: 'golden', target: 2, label: 'Collect 2 golden commits' },
    goldenEvery: 3,
    goldenTtlFactor: 1.35,
  },
  {
    id: 'tight-loop',
    title: 'Tight Feedback Loop',
    modifier: 'The combo window is shorter, but each combo tier is twice as valuable.',
    objective: { kind: 'streak', target: 8, label: 'Build an 8-commit streak' },
    streakWindow: 30,
    multiplierStep: 1,
  },
  {
    id: 'ship-it',
    title: 'Ship It',
    modifier: 'Levels arrive sooner, so the release train accelerates quickly.',
    objective: { kind: 'level', target: 6, label: 'Reach level 6' },
    levelEvery: 35,
  },
];

function stableHash(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function dailyBriefFor(day, rules = 4) {
  if (rules < 4) return null;
  return DAILY_BRIEFS[stableHash(day || 'daily') % DAILY_BRIEFS.length];
}

export function dailyObjectiveProgress(game) {
  const objective = game?.dailyBrief?.objective;
  if (!objective) return { current: 0, target: 0, complete: false, label: '' };
  const current = {
    score: game.score,
    golden: game.goldenEaten,
    streak: game.bestStreak,
    level: game.level,
  }[objective.kind] || 0;
  return {
    current,
    target: objective.target,
    complete: current >= objective.target,
    label: objective.label,
  };
}


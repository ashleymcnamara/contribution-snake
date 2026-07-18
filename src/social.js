import { dailyObjectiveProgress } from './game/daily.js';

const START_DAY = Date.UTC(2026, 0, 1);
const DAY_MS = 86400000;
const CELL_COUNT = 5;

export const SHARE_SKINS = {
  github: 'GitHub Green',
  gold: 'Golden Merge',
  neon: 'Neon Maintainer',
};

export function dailyChallengeNumber(day) {
  const ms = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.max(1, Math.floor((ms - START_DAY) / DAY_MS) + 1) : 1;
}

function thresholdCount(value, thresholds) {
  return thresholds.filter((threshold) => value >= threshold).length;
}

function progressCount(current, target) {
  if (!target || current <= 0) return 0;
  if (current >= target) return CELL_COUNT;
  return Math.max(1, Math.floor((current / target) * CELL_COUNT));
}

function cells(filled, emoji) {
  return `${emoji.repeat(filled)}${'⬛'.repeat(CELL_COUNT - filled)}`;
}

export function dailyScorecard(game) {
  const objective = dailyObjectiveProgress(game);
  const score = Math.max(0, Number(game?.score) || 0);
  const streak = Math.max(0, Number(game?.bestStreak) || 0);
  const bonus = Math.max(0, Number(game?.goldenEaten) || 0);
  const goalValue = objective.target
    ? `${Math.min(objective.current, objective.target)}/${objective.target}`
    : '—';

  return [
    {
      key: 'score',
      label: 'Score',
      value: String(score),
      filled: thresholdCount(score, [25, 50, 100, 150, 250]),
      tone: 'success',
    },
    {
      key: 'streak',
      label: 'Streak',
      value: String(streak),
      filled: thresholdCount(streak, [2, 4, 6, 8, 10]),
      tone: 'success',
    },
    {
      key: 'bonus',
      label: 'Bonus',
      value: String(bonus),
      filled: Math.min(CELL_COUNT, bonus),
      tone: 'bonus',
    },
    {
      key: 'goal',
      label: 'Goal',
      value: goalValue,
      filled: progressCount(objective.current, objective.target),
      tone: 'success',
    },
  ].map((row) => ({
    ...row,
    cells: cells(row.filled, row.tone === 'bonus' ? '🟨' : '🟩'),
  }));
}

export function dailyShareGrid(game) {
  return dailyScorecard(game)
    .map((row) => `${row.label} ${row.value}  ${row.cells}`)
    .join('\n');
}

export function normalizeShareProfile(profile) {
  const rawStreak = Number(profile?.dailyStreak);
  const dailyStreak = Number.isFinite(rawStreak)
    ? Math.max(0, Math.min(999, Math.trunc(rawStreak)))
    : 0;
  const skinId = Object.hasOwn(SHARE_SKINS, profile?.skinId) ? profile.skinId : 'github';
  return { dailyStreak, skinId };
}

function nonNegativeInt(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function positiveInt(value) {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function mergeDailyLocalResult(previous, score) {
  const rank = positiveInt(previous?.rank);
  return {
    score: Math.max(nonNegativeInt(previous?.score), nonNegativeInt(score)),
    rank,
    rankedScore: rank
      ? nonNegativeInt(previous?.rankedScore ?? previous?.score)
      : null,
    claimed: previous?.claimed === true || rank !== null,
  };
}

export function claimDailyLocalResult(previous, score, rank) {
  const result = mergeDailyLocalResult(previous, score);
  return {
    ...result,
    rank: positiveInt(rank),
    rankedScore: nonNegativeInt(score),
    claimed: true,
  };
}

export function dailyShareSignature({
  rank = null,
  rankLabel = 'today',
  dailyStreak = 0,
  skinId = 'github',
} = {}) {
  const profile = normalizeShareProfile({ dailyStreak, skinId });
  return [
    rank ? `#${rank} ${rankLabel}` : null,
    profile.dailyStreak ? `${profile.dailyStreak}-day streak` : null,
    `Style: ${SHARE_SKINS[profile.skinId]}`,
  ].filter(Boolean).join(' · ');
}

export function dailyShareText({
  game,
  day,
  rank = null,
  rankLabel = 'today',
  dailyStreak = 0,
  skinId = 'github',
} = {}) {
  const objective = dailyObjectiveProgress(game);
  const goal = objective.label
    ? `Goal: ${objective.label}${objective.complete ? ' · complete' : ''}`
    : null;
  return [
    `GitSnake Daily #${dailyChallengeNumber(day)} 🐍`,
    dailyShareGrid(game),
    goal,
    dailyShareSignature({
      rank, rankLabel, dailyStreak, skinId,
    }),
    'Can you beat it?',
  ].filter(Boolean).join('\n');
}

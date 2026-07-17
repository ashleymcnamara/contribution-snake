import { CAMPAIGN_LEVELS } from './game/campaign.js';

const KEY = 'gh-snake-progression';

export const COSMETICS = [
  {
    id: 'github',
    kind: 'skin',
    name: 'GitHub Green',
    description: 'The original contribution-gradient snake.',
    requirement: null,
  },
  {
    id: 'gold',
    kind: 'skin',
    name: 'Golden Merge',
    description: 'A warm gold gradient for a committed daily player.',
    requirement: { metric: 'dailyStreak', target: 3, label: '3-day Daily streak' },
    colors: { head: '#ffd33d', levels: ['#7d4e00', '#b97900', '#e3b341', '#ffd33d'] },
  },
  {
    id: 'neon',
    kind: 'skin',
    name: 'Neon Maintainer',
    description: 'A pink-purple skin earned by finishing Daily objectives.',
    requirement: { metric: 'dailyObjectives', target: 5, label: '5 Daily objectives' },
    colors: { head: '#f778ba', levels: ['#512a6b', '#8250df', '#bf4baf', '#f778ba'] },
  },
  {
    id: 'default-board',
    kind: 'board',
    name: 'Contribution Grid',
    description: 'The familiar GitHub contribution board.',
    requirement: null,
  },
  {
    id: 'terminal',
    kind: 'board',
    name: 'Terminal',
    description: 'A deep command-line grid for campaign regulars.',
    requirement: { metric: 'campaignWins', target: 2, label: 'Clear 2 campaign levels' },
    colors: { empty: '#07110a', border: 'rgba(57, 211, 83, 0.16)' },
  },
  {
    id: 'midnight',
    kind: 'board',
    name: 'Midnight Deploy',
    description: 'A blue-black grid unlocked by a full Daily week.',
    requirement: { metric: 'dailyStreak', target: 7, label: '7-day Daily streak' },
    colors: { empty: '#0a1020', border: 'rgba(121, 192, 255, 0.18)' },
  },
  {
    id: 'none',
    kind: 'trail',
    name: 'No Trail',
    description: 'Clean, classic movement.',
    requirement: null,
  },
  {
    id: 'spark',
    kind: 'trail',
    name: 'Commit Spark',
    description: 'A soft glow earned deep in the campaign.',
    requirement: { metric: 'campaignWins', target: 4, label: 'Clear 4 campaign levels' },
    trail: { color: '#ffd33d', blur: 9 },
  },
  {
    id: 'comet',
    kind: 'trail',
    name: 'Daily Comet',
    description: 'A bright cyan trail for a two-week Daily streak.',
    requirement: { metric: 'dailyStreak', target: 14, label: '14-day Daily streak' },
    trail: { color: '#79c0ff', blur: 13 },
  },
];

const DEFAULT_SELECTION = {
  skin: 'github',
  board: 'default-board',
  trail: 'none',
};

export function loadProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    return {
      campaignCompleted: Array.isArray(saved.campaignCompleted) ? saved.campaignCompleted : [],
      dailyObjectives: Array.isArray(saved.dailyObjectives) ? saved.dailyObjectives : [],
      selected: { ...DEFAULT_SELECTION, ...(saved.selected || {}) },
    };
  } catch {
    return { campaignCompleted: [], dailyObjectives: [], selected: { ...DEFAULT_SELECTION } };
  }
}

function saveProgress(progress) {
  localStorage.setItem(KEY, JSON.stringify(progress));
}

export function metricValue(metric, stats, progress) {
  if (metric === 'dailyStreak') return Number(stats?.dailyStreak) || 0;
  if (metric === 'dailyObjectives') return progress.dailyObjectives.length;
  if (metric === 'campaignWins') return progress.campaignCompleted.length;
  return 0;
}

export function cosmeticUnlocked(cosmetic, stats, progress = loadProgress()) {
  if (!cosmetic.requirement) return true;
  const { metric, target } = cosmetic.requirement;
  return metricValue(metric, stats, progress) >= target;
}

export function campaignUnlocked(id, progress = loadProgress()) {
  const index = CAMPAIGN_LEVELS.findIndex((level) => level.id === id);
  if (index <= 0) return index === 0;
  return progress.campaignCompleted.includes(CAMPAIGN_LEVELS[index - 1].id);
}

export function recordProgress({
  stats,
  previousStats = stats,
  mode,
  day = null,
  objectiveComplete = false,
  campaignId = null,
  won = false,
}) {
  const progress = loadProgress();
  const before = new Set(COSMETICS.filter((item) => cosmeticUnlocked(item, previousStats, progress))
    .map((item) => item.id));
  let dailyObjectiveCompleted = false;
  let campaignCompleted = false;

  if (mode === 'daily' && day && objectiveComplete && !progress.dailyObjectives.includes(day)) {
    progress.dailyObjectives.push(day);
    dailyObjectiveCompleted = true;
  }
  if (mode === 'campaign' && won && campaignId
      && !progress.campaignCompleted.includes(campaignId)) {
    progress.campaignCompleted.push(campaignId);
    campaignCompleted = true;
  }

  saveProgress(progress);
  const unlocked = COSMETICS.filter((item) =>
    !before.has(item.id) && cosmeticUnlocked(item, stats, progress));
  return { progress, unlocked, dailyObjectiveCompleted, campaignCompleted };
}

export function selectCosmetic(kind, id, stats) {
  const cosmetic = COSMETICS.find((item) => item.kind === kind && item.id === id);
  if (!cosmetic) return false;
  const progress = loadProgress();
  if (!cosmeticUnlocked(cosmetic, stats, progress)) return false;
  progress.selected[kind] = id;
  saveProgress(progress);
  return true;
}

export function resolveLoadout(stats) {
  const progress = loadProgress();
  const selected = {};
  for (const kind of ['skin', 'board', 'trail']) {
    const preferred = COSMETICS.find((item) =>
      item.kind === kind && item.id === progress.selected[kind]
      && cosmeticUnlocked(item, stats, progress));
    selected[kind] = preferred || COSMETICS.find((item) =>
      item.kind === kind && item.id === DEFAULT_SELECTION[kind]);
  }
  return selected;
}

const vertical = (x, from, to, gaps = []) => {
  const skip = new Set(gaps);
  return Array.from({ length: to - from + 1 }, (_, i) => ({ x, y: from + i }))
    .filter(({ y }) => !skip.has(y));
};

const horizontal = (y, from, to, gaps = []) => {
  const skip = new Set(gaps);
  return Array.from({ length: to - from + 1 }, (_, i) => ({ x: from + i, y }))
    .filter(({ x }) => !skip.has(x));
};

export const CAMPAIGN_LEVELS = [
  {
    id: 'first-commit',
    name: 'First Commit',
    description: 'Learn the loop and collect six clean commits.',
    target: 6,
    seed: 1101,
    walls: [],
  },
  {
    id: 'merge-queue',
    name: 'Merge Queue',
    description: 'Thread two review lanes without blocking the queue.',
    target: 8,
    seed: 2202,
    walls: [
      ...vertical(10, 2, 19, [5, 15]),
      ...vertical(25, 2, 19, [7, 17]),
    ],
  },
  {
    id: 'ci-pipeline',
    name: 'CI Pipeline',
    description: 'Ship through alternating gates as the build speeds up.',
    target: 10,
    seed: 3303,
    walls: [
      ...horizontal(5, 3, 32, [8, 27]),
      ...horizontal(11, 3, 32, [15, 20]),
      ...horizontal(17, 3, 32, [8, 27]),
    ],
  },
  {
    id: 'release-train',
    name: 'Release Train',
    description: 'Navigate the carriages and keep the release moving.',
    target: 12,
    seed: 4404,
    walls: [
      ...vertical(7, 3, 18, [6, 14]),
      ...vertical(14, 3, 18, [9, 16]),
      ...vertical(28, 3, 18, [6, 14]),
      ...horizontal(3, 7, 28, [18]),
      ...horizontal(18, 7, 28, [21]),
    ],
  },
  {
    id: 'open-source-summit',
    name: 'Open Source Summit',
    description: 'Cross every maintainer lane and finish the campaign.',
    target: 15,
    seed: 5505,
    walls: [
      ...horizontal(4, 4, 31, [9, 18, 27]),
      ...horizontal(17, 4, 31, [9, 18, 27]),
      ...vertical(4, 4, 17, [10]),
      ...vertical(31, 4, 17, [11]),
      ...vertical(13, 7, 14, [11]),
      ...vertical(22, 7, 14, [10]),
    ],
  },
];

export function campaignLevel(id) {
  return CAMPAIGN_LEVELS.find((level) => level.id === id) || null;
}

export function nextCampaignLevel(id) {
  const index = CAMPAIGN_LEVELS.findIndex((level) => level.id === id);
  return index >= 0 ? CAMPAIGN_LEVELS[index + 1] || null : null;
}


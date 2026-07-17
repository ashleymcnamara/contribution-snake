// Fetches a user's GitHub contribution calendar and normalizes it to the
// game's board shape: grid[52 cols][7 rows] of levels 0-4, rows Monday-first.
// Pure fetch + transform — caching lives in logic.js via the store.
//
// Two strategies:
//  - GITHUB_TOKEN set  → official GraphQL API (exact, includes totals)
//  - no token          → parse the public HTML calendar at
//                        github.com/users/<name>/contributions

const USERNAME_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const LEVEL_ENUM = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

export function isValidUsername(name) {
  // Explicit string check: RegExp.test coerces undefined to "undefined",
  // which would pass the pattern.
  return typeof name === 'string' && USERNAME_RE.test(name);
}

export function isValidContributionYear(year) {
  const value = Number(year);
  return Number.isInteger(value) && value >= 2008 && value <= new Date().getUTCFullYear();
}

function yearRange(year) {
  if (!year) return null;
  return {
    from: `${year}-01-01T00:00:00Z`,
    to: `${year}-12-31T23:59:59Z`,
  };
}

async function fetchViaGraphQL(username, token, year) {
  const range = yearRange(year);
  const query = `
    query($login: String!${range ? ', $from: DateTime!, $to: DateTime!' : ''}) {
      user(login: $login) {
        contributionsCollection${range ? '(from: $from, to: $to)' : ''} {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays { date contributionLevel }
            }
          }
        }
      }
    }`;
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'gitsnake',
    },
    body: JSON.stringify({ query, variables: { login: username, ...(range || {}) } }),
  });
  if (!res.ok) throw new Error(`GitHub API error (${res.status})`);
  const json = await res.json();
  const calendar = json.data?.user?.contributionsCollection?.contributionCalendar;
  if (!calendar) throw new Error('GitHub user not found');

  const days = [];
  for (const week of calendar.weeks) {
    for (const d of week.contributionDays) {
      days.push({ date: d.date, level: LEVEL_ENUM[d.contributionLevel] ?? 0 });
    }
  }
  return { days, total: calendar.totalContributions, source: 'graphql' };
}

async function fetchViaScrape(username, year) {
  const url = new URL(`https://github.com/users/${username}/contributions`);
  if (year) {
    url.searchParams.set('from', `${year}-01-01`);
    url.searchParams.set('to', `${year}-12-31`);
  }
  const res = await fetch(url, {
    headers: { 'User-Agent': 'gitsnake' },
  });
  if (res.status === 404) throw new Error('GitHub user not found');
  if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
  const html = await res.text();

  // Calendar cells carry data-date and data-level attributes (order varies).
  const days = [];
  const cellRe = /<td[^>]*data-date="(\d{4}-\d{2}-\d{2})"[^>]*data-level="(\d)"[^>]*>|<td[^>]*data-level="(\d)"[^>]*data-date="(\d{4}-\d{2}-\d{2})"[^>]*>/g;
  let m;
  while ((m = cellRe.exec(html)) !== null) {
    const date = m[1] || m[4];
    const level = parseInt(m[2] ?? m[3], 10);
    days.push({ date, level: Math.min(4, Math.max(0, level)) });
  }
  if (!days.length) throw new Error('Could not read the contribution calendar');
  return { days, total: null, source: 'scrape' };
}

export function fetchContributionDays(username, token, year = null) {
  // Test-only escape hatch: the real fetchers hit GitHub (GraphQL or the public
  // calendar page), which e2e can't depend on. When SNAKE_FAKE_CONTRIBS is set,
  // return a deterministic synthetic year for any username so graph mode can be
  // exercised offline. Never set this in production.
  if (process.env.SNAKE_FAKE_CONTRIBS) return Promise.resolve(fakeContributionDays(year));
  return token ? fetchViaGraphQL(username, token, year) : fetchViaScrape(username, year);
}

// A fixed 52-week calendar with a mix of levels 0-4, matching the { date, level }
// shape of the real fetchers. Deterministic (LCG + a fixed end date) so the same
// grid is served for both session creation and replay validation. TEST ONLY.
function fakeContributionDays(year = null) {
  const days = [];
  const end = new Date(`${year || 2024}-12-31T00:00:00Z`);
  let s = 1234567;
  for (let i = 52 * 7 - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(end.getUTCDate() - i);
    s = (s * 1103515245 + 12345) & 0x7fffffff; // LCG → deterministic 0-4 spread
    days.push({ date: d.toISOString().slice(0, 10), level: s % 5 });
  }
  const total = days.reduce((n, day) => n + day.level, 0);
  return { days, total, source: 'fake' };
}

// Normalize a flat day list into the game grid. Columns are weeks (oldest
// first), rows are weekdays Monday-first to match the board's day labels.
export function toGrid(days) {
  days.sort((a, b) => a.date.localeCompare(b.date));
  // Keep the most recent 52 whole weeks.
  const byDate = days.slice(-52 * 7);
  const first = new Date(byDate[0].date + 'T00:00:00Z');
  // Align column 0 to the Monday of the first date's week.
  const firstMonday = new Date(first);
  firstMonday.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7));

  const grid = Array.from({ length: 52 }, () => new Array(7).fill(0));
  for (const { date, level } of byDate) {
    const d = new Date(date + 'T00:00:00Z');
    const col = Math.floor((d - firstMonday) / (7 * 24 * 3600 * 1000));
    const row = (d.getUTCDay() + 6) % 7; // Monday = 0
    if (col >= 0 && col < 52) grid[col][row] = level;
  }

  const months = Array.from({ length: 12 }, (_, i) =>
    MONTH_NAMES[(firstMonday.getUTCMonth() + i) % 12]);
  return { grid, months };
}

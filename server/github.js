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

async function fetchViaGraphQL(username, token) {
  const query = `
    query($login: String!) {
      user(login: $login) {
        contributionsCollection {
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
      'User-Agent': 'contribution-snake',
    },
    body: JSON.stringify({ query, variables: { login: username } }),
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

async function fetchViaScrape(username) {
  const res = await fetch(`https://github.com/users/${username}/contributions`, {
    headers: { 'User-Agent': 'contribution-snake' },
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

export function fetchContributionDays(username, token) {
  return token ? fetchViaGraphQL(username, token) : fetchViaScrape(username);
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

// End-to-end smoke test: the critical path a unit suite can't see.
// The snake runs into the right wall on its own, so a full run needs no
// keyboard input — click Classic, wait for Game Over, submit, verify.
import { test, expect } from '@playwright/test';

async function contrastRatio(page, selector) {
  return page.locator(selector).first().evaluate((element) => {
    const channels = (value) => value.match(/[\d.]+/g).slice(0, 3).map(Number);
    const luminance = (value) => {
      const [r, g, b] = channels(value).map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.04045
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    let surface = element;
    let background = 'rgba(0, 0, 0, 0)';
    while (surface) {
      background = getComputedStyle(surface).backgroundColor;
      if (!background.endsWith(', 0)')) break;
      surface = surface.parentElement;
    }
    const foregroundLuminance = luminance(getComputedStyle(element).color);
    const backgroundLuminance = luminance(background);
    const lighter = Math.max(foregroundLuminance, backgroundLuminance);
    const darker = Math.min(foregroundLuminance, backgroundLuminance);
    return (lighter + 0.05) / (darker + 0.05);
  });
}

async function startClassic(page) {
  await page.click('#btn-classic');
  await expect(page.locator('#overlay-title')).toHaveText('Classic');
  await page.click('#btn-endless');
}

async function submitClassicAndOpenLeaderboard(page, name) {
  await startClassic(page);
  await expect(page.locator('#overlay-title')).toHaveText('Game Over', { timeout: 20000 });
  await page.fill('#name-input', name);
  await page.click('#btn-submit');
  await expect(page.locator('#overlay-sub')).toContainText('Verified', { timeout: 10000 });
  const row = page.locator('.lb-row.watchable').filter({ hasText: name }).first();
  await row.locator('.lb-watch-target').click();
  await expect(page.locator('#board-label')).toContainText('Watching', { timeout: 5000 });
  await page.keyboard.press('Escape');
  await expect(page.locator('#overlay-title')).toHaveText('Leaderboard');
}

test('classic run: play, die, submit, verified standings entry', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#overlay-title')).toHaveText('GitSnake');

  await startClassic(page);
  // Unattended, the snake hits the wall in ~2s; death animation follows.
  await expect(page.locator('#overlay-title')).toHaveText('Game Over', { timeout: 20000 });

  await page.fill('#name-input', 'e2e-bot');
  await page.click('#btn-submit');
  await expect(page.locator('#overlay-sub')).toContainText('Verified', { timeout: 10000 });

  // The submitted run appears on the leaderboard and is watchable.
  const row = page.locator('.lb-row.watchable').first();
  await expect(row).toBeVisible();
  await expect(row).not.toHaveAttribute('role', 'button');
  await expect(row.locator('button button')).toHaveCount(0);
  await row.locator('.lb-watch-target').click();
  await expect(page.locator('#board-label')).toContainText('Watching', { timeout: 5000 });
  await expect(page.locator('#spect-bar')).toHaveAttribute('type', 'range');

  // Esc exits spectate back to the leaderboard screen, which opens on the
  // all-time board — the run shows there, tagged with the mode it came from.
  await page.keyboard.press('Escape');
  await expect(page.locator('#overlay-title')).toHaveText('Leaderboard');
  await expect(page.locator('#lb-tab-all')).toHaveClass(/active/);
  await expect(page.locator('#leaderboard')).toContainText('Top scores across every mode');
  await expect(page.locator('.lb-row').filter({ hasText: 'e2e-bot' }).first()).toContainText('Classic');
  // The standalone Classic and Yesterday boards remain gone, and there is no
  // Friends setup surface competing with the result-driven standings.
  await expect(page.locator('#lb-tab-classic')).toHaveCount(0);
  await expect(page.locator('#lb-tab-yesterday')).toHaveCount(0);
  await expect(page.locator('#lb-tab-friends')).toHaveCount(0);
  await expect(page.locator('#friends-row')).toHaveCount(0);
});

test('Daily result shares a scorecard and opens as a ghost challenge', async ({ page, context }) => {
  test.setTimeout(60000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.click('#btn-daily');
  await expect(page.locator('#overlay-title')).toHaveText('Game Over', { timeout: 20000 });

  const preview = page.locator('#daily-share-preview');
  await expect(preview).toBeVisible();
  await expect(preview.locator('.daily-share-row')).toHaveCount(4);
  await expect(preview).toContainText('Score');
  await expect(preview).toContainText('Streak');
  await expect(preview).toContainText('Bonus');
  await expect(preview).toContainText('Goal');
  await expect(preview).toContainText('Submit your score to add rank and a raceable ghost.');
  await expect(preview.locator('.daily-share-objective svg')).toHaveCount(1);
  await expect(preview.locator('.daily-share-signature svg')).toHaveCount(2);
  await expect(preview.locator('.daily-share-challenge svg')).toHaveCount(1);
  expect(await preview.textContent()).not.toMatch(/[🎯🔥🎨]/u);
  await expect(page.locator('#btn-copy')).toHaveText('Share Daily');
  await expect(page.locator('#btn-share')).toHaveText('Download card');

  await page.fill('#name-input', 'e2e-daily');
  await page.click('#btn-submit');
  await expect(page.locator('#overlay-sub')).toContainText('Verified', { timeout: 10000 });
  await expect(preview).toContainText('Ghost challenge link ready.');
  await expect(preview.locator('.daily-share-heading')).toContainText('#1');

  await page.click('#btn-copy');
  await expect(page.locator('#btn-copy')).toHaveText('Copied!');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('GitSnake Daily #');
  expect(copied).toContain('Score ');
  expect(copied).toContain('Streak ');
  expect(copied).toContain('Bonus ');
  expect(copied).toContain('Goal ');
  expect(copied).toContain('🐍');
  expect(copied).not.toMatch(/[🎯🔥🎨]/u);
  expect(copied).toMatch(/\/r\/[0-9A-Za-z]{8}$/);

  const leaderboard = await page.evaluate(async () => {
    const response = await fetch('/api/leaderboard?mode=daily');
    return response.json();
  });
  const replayId = leaderboard.entries.find((entry) => entry.name === 'e2e-daily').replayId;

  // Force the next zero-point practice run to become the saved local best.
  // The one-shot claim and first-run rank must survive that overwrite.
  await page.evaluate(() => {
    const day = new Date().toISOString().slice(0, 10);
    const key = `gh-snake-daily-${day}`;
    const result = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify({ ...result, score: -1 }));
  });
  await page.click('#btn-again');
  await expect(page.locator('#overlay')).toBeHidden();
  await expect(page.locator('#overlay-title')).toHaveText('Game Over', { timeout: 20000 });
  await expect(preview).toContainText('Practice scorecard');
  await expect(preview).not.toContainText('Submit your score to add rank');

  await page.route(`**/api/replay/${replayId}`, async (route) => {
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.fulfill({ response });
  });
  await page.goto(`/?daily=1&ghost=${replayId}`);
  await page.click('#btn-classic');
  await expect(page.locator('#overlay-title')).toHaveText('Classic');
  await page.waitForTimeout(800);
  await expect(page.locator('#overlay-title')).toHaveText('Classic');
  await page.unroute(`**/api/replay/${replayId}`);

  await page.goto(`/?daily=1&ghost=${replayId}`);
  await expect(page.locator('#overlay-sub')).toContainText('e2e-daily scored');
  await expect(page.locator('#daily-entry-copy')).toContainText("Race e2e-daily's");

  await page.click('#btn-daily');
  await expect(page.locator('#board-label')).toContainText('racing e2e-daily', { timeout: 10000 });
});

test('late score verification does not overwrite a newer screen', async ({ page }) => {
  await page.goto('/');
  await page.click('#btn-daily');
  await expect(page.locator('#overlay-title')).toHaveText('Game Over', { timeout: 20000 });

  await page.route('**/api/scores', async (route) => {
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.fulfill({ response });
  });
  await page.fill('#name-input', 'slow-submit');
  await page.click('#btn-submit');
  await expect(page.locator('#btn-submit')).toHaveText('Verifying…');
  await page.click('#btn-menu');
  await expect(page.locator('#overlay-title')).toHaveText('GitSnake');
  await page.waitForTimeout(800);
  await expect(page.locator('#overlay-title')).toHaveText('GitSnake');
  await expect(page.locator('#mode-buttons')).toBeVisible();
  await expect(page.locator('#leaderboard')).toBeHidden();
});

test('late Daily verification turns a newer result into practice', async ({ page }) => {
  test.setTimeout(60000);
  let releaseResponse;
  let markProcessed;
  const responseHold = new Promise((resolve) => { releaseResponse = resolve; });
  const scoreProcessed = new Promise((resolve) => { markProcessed = resolve; });

  await page.goto('/');
  await page.click('#btn-daily');
  await expect(page.locator('#overlay-title')).toHaveText('Game Over', { timeout: 20000 });
  await page.route('**/api/scores', async (route) => {
    const response = await route.fetch();
    markProcessed();
    await responseHold;
    await route.fulfill({ response });
  });

  await page.fill('#name-input', 'first-ranked');
  await page.click('#btn-submit');
  await scoreProcessed;
  await page.click('#btn-again');
  await expect(page.locator('#overlay')).toBeHidden();
  await expect(page.locator('#overlay-title')).toHaveText('Game Over', { timeout: 20000 });
  await expect(page.locator('#submit-row')).toBeVisible();

  releaseResponse();
  await expect(page.locator('#submit-row')).toBeHidden();
  await expect(page.locator('#overlay-sub')).toContainText('first ranked run already owns this Daily');
  await expect(page.locator('#daily-share-preview')).toContainText('Practice scorecard');
});

test('slow Daily startup does not override newer navigation', async ({ page }) => {
  await page.goto('/');
  await page.route('**/api/session', async (route) => {
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.fulfill({ response });
  });

  await page.click('#btn-daily');
  await page.locator('#btn-classic').evaluate((button) => button.click());
  await expect(page.locator('#overlay-title')).toHaveText('Classic');
  await page.waitForTimeout(800);
  await expect(page.locator('#overlay-title')).toHaveText('Classic');
  await expect(page.locator('#classic-hub')).toBeVisible();
});

test('watching a replay cancels an in-flight Daily startup', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('gh-snake-bestrun-classic', JSON.stringify({
      mode: 'classic',
      seed: 123,
      rules: 2,
      inputs: [],
      score: 1,
    }));
  });
  await page.route('**/api/session', async (route) => {
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.fulfill({ response });
  });
  await page.goto('/');
  await page.click('#btn-daily');
  await page.click('#btn-progress');
  await page.click('#btn-progress-watch');
  await expect(page.locator('#board-label')).toContainText('Your best classic run');
  await page.waitForTimeout(800);
  await expect(page.locator('#board-label')).toContainText('Your best classic run');
  await expect(page.locator('#spectate-cta')).toBeVisible();
});

test('newest leaderboard tab wins when responses arrive out of order', async ({ page }) => {
  await page.goto('/');
  await page.route('**/api/leaderboard?mode=all*', async (route) => {
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.fulfill({ response });
  });

  await page.click('#btn-leaderboard');
  await page.click('#lb-tab-daily');
  await expect(page.locator('#lb-tab-daily')).toHaveClass(/active/);
  await expect(page.locator('#leaderboard')).not.toContainText('Loading…');
  await page.waitForTimeout(800);
  await expect(page.locator('#lb-tab-daily')).toHaveClass(/active/);
  await expect(page.locator('#leaderboard')).not.toContainText('Top scores across every mode');
});

test('late replay hydration does not leave the screen the player chose', async ({ page }) => {
  await page.goto('/');
  await submitClassicAndOpenLeaderboard(page, 'slow-replay');

  const row = page.locator('.lb-row.watchable').filter({ hasText: 'slow-replay' }).first();
  const watch = row.locator('.lb-watch-target');
  const replayId = await watch.getAttribute('data-replay');
  await page.route(`**/api/replay/${replayId}`, async (route) => {
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.fulfill({ response });
  });
  await watch.click();
  await page.click('#lb-tab-daily');
  await expect(page.locator('#overlay-title')).toHaveText('Leaderboard');
  await page.waitForTimeout(800);
  await expect(page.locator('#overlay-title')).toHaveText('Leaderboard');
  await expect(page.locator('#lb-tab-daily')).toHaveClass(/active/);
  await expect(page.locator('#spectate-cta')).toBeHidden();
});

test('late health response reconciles server controls without navigating', async ({ page }) => {
  await page.route('**/api/health', async (route) => {
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.fulfill({ response });
  });
  await page.goto('/');
  await page.click('#btn-classic');
  await page.click('#classic-back');
  await expect(page.locator('#btn-daily')).toBeDisabled();
  await page.waitForTimeout(800);
  await expect(page.locator('#overlay-title')).toHaveText('GitSnake');
  await expect(page.locator('#btn-daily')).toBeEnabled();
  await expect(page.locator('#btn-graph')).toBeEnabled();
  await expect(page.locator('#mode-note')).toBeHidden();
  await expect(page.locator('#btn-leaderboard')).toBeVisible();
  await expect(page.locator('#btn-locker')).toBeVisible();
  await expect(page.locator('#daily-note')).toBeVisible();
});

test('clean Classic waits for health before starting ranked', async ({ page }) => {
  await page.route('**/api/health', async (route) => {
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.fulfill({ response });
  });
  await page.goto('/');
  await expect(page.locator('#btn-daily')).toBeDisabled();
  await page.click('#btn-classic');
  await expect(page.locator('#btn-endless .btn-subline')).toContainText('Checking ranked play');
  const sessionRequest = page.waitForRequest('**/api/session');
  await page.click('#btn-endless');
  await expect(page.locator('#overlay-sub')).toContainText('Checking ranked play');
  await page.waitForTimeout(200);
  await expect(page.locator('#overlay')).toBeVisible();
  await sessionRequest;
  await expect(page.locator('#overlay')).toBeHidden();
  await expect(page.locator('#board-label')).toContainText('Snake graph');
  await expect(page.locator('#board-label')).not.toContainText('offline');
});

test('offline Classic is explicitly local-only', async ({ page }) => {
  await page.route('**/api/health', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'offline' }),
  }));
  await page.goto('/');
  await page.click('#btn-classic');
  await expect(page.locator('#btn-endless .btn-subline')).toContainText('Offline · local score only');
  await page.click('#btn-endless');
  await expect(page.locator('#overlay')).toBeHidden();
  await expect(page.locator('#board-label')).toContainText('offline (local score only)');
});

test('theme, palette, and pause controls', async ({ page }) => {
  await page.goto('/');

  await page.hover('#btn-classic');
  await page.waitForTimeout(200);
  expect(await contrastRatio(page, '#btn-classic')).toBeGreaterThanOrEqual(4.5);

  const initialTheme = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.click('#theme-btn');
  const flippedTheme = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(flippedTheme).not.toBe(initialTheme);

  const greenLevel = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--level-4').trim());
  await expect(page.locator('#palette-btn')).toHaveAttribute('aria-pressed', 'false');
  await page.click('#palette-btn');
  await expect(page.locator('#palette-btn')).toHaveAttribute('aria-pressed', 'true');
  const blueLevel = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--level-4').trim());
  expect(blueLevel).not.toBe(greenLevel);
  expect(await page.locator('.touch-btn[data-dir]').evaluateAll((buttons) =>
    buttons.map((button) => button.tagName))).toEqual(['BUTTON', 'BUTTON', 'BUTTON', 'BUTTON']);

  // Pause and resume mid-game. Starting is async (session fetch) and now opens
  // with a 3-2-1 countdown, so wait for the overlay to hide and the countdown
  // to finish — the game isn't pausable until it's actually playing.
  await startClassic(page);
  await expect(page.locator('#overlay')).toBeHidden();
  await expect(page.locator('#countdown')).toBeVisible();
  await expect(page.locator('#countdown')).toBeHidden();
  await page.keyboard.press(' ');
  await expect(page.locator('#overlay-title')).toHaveText('Paused');
  await page.click('#btn-resume');
  await expect(page.locator('#overlay')).toBeHidden();
});

test('a direction key skips the pre-run countdown and steers immediately', async ({ page }) => {
  await page.goto('/');
  await startClassic(page);
  await expect(page.locator('#countdown')).toBeVisible();
  await page.keyboard.press('ArrowUp');
  // Skipped well before the 1.5s countdown would finish on its own.
  await expect(page.locator('#countdown')).toBeHidden({ timeout: 500 });
  await expect(page.locator('#pause-btn')).toBeEnabled();
});

test('graph-mode deep link primes the username', async ({ page }) => {
  await page.goto('/?user=octocat');
  await expect(page.locator('#username-input')).toHaveValue('octocat');
  await expect(page.locator('#overlay-sub')).toContainText('challenged');
});

test('wrap-walls variant plays unranked and survives the edge', async ({ page }) => {
  await page.goto('/');
  await page.click('#btn-classic');
  await expect(page.locator('#overlay-title')).toHaveText('Classic');
  // Endless customization is revealed only after choosing Classic.
  await page.click('#variant-summary');
  await page.check('#var-wrap');
  await expect(page.locator('#variant-note')).toBeVisible();
  await expect(page.locator('#variant-summary')).toContainText('wrap');

  await page.click('#btn-endless');
  await expect(page.locator('#board-label')).toContainText('unranked');

  // Un-wrapped, the unattended snake dies in ~2s. With wrap it crosses the
  // edge and keeps going — still playing well past that point.
  await page.waitForTimeout(4500);
  await expect(page.locator('#overlay')).toBeHidden();
});

test('Progress combines stats and the best-run replay after a finished run', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await startClassic(page);
  await expect(page.locator('#btn-menu')).toBeVisible({ timeout: 20000 });

  await page.click('#btn-menu');
  await expect(page.locator('#btn-progress')).toBeVisible();
  await expect(page.locator('#btn-watch-best')).toHaveCount(0);
  await expect(page.locator('#btn-stats')).toHaveCount(0);
  await expect(page.locator('#btn-achievements')).toHaveCount(0);
  await expect(page.locator('#menu-links > button:visible')).toHaveText([
    'Leaderboard', 'Progress', 'Locker',
  ]);
  await page.click('#btn-progress');
  await expect(page.locator('#overlay-title')).toHaveText('Progress');
  await expect(page.locator('#stats-panel')).toContainText('games played');
  await expect(page.locator('#btn-progress-watch')).toBeVisible();
  expect(await page.locator('.header').evaluate((header) => header.inert)).toBe(true);
  const headerObscuresProgress = await page.evaluate(() => {
    const header = document.querySelector('.header').getBoundingClientRect();
    const stats = document.querySelector('#stats-panel').getBoundingClientRect();
    const left = Math.max(header.left, stats.left);
    const right = Math.min(header.right, stats.right);
    const top = Math.max(header.top, stats.top);
    const bottom = Math.min(header.bottom, stats.bottom);
    if (left >= right || top >= bottom) return false;
    return Boolean(document.elementFromPoint((left + right) / 2, (top + bottom) / 2)
      ?.closest('.header'));
  });
  expect(headerObscuresProgress).toBe(false);
  await page.click('#progress-back');
  await expect(page.locator('#overlay-title')).toHaveText('GitSnake');
});

test('finishing a first game shows achievement progress inside Progress', async ({ page }) => {
  await page.goto('/');
  await startClassic(page);
  await expect(page.locator('#btn-menu')).toBeVisible({ timeout: 20000 });

  // The very first finished run unlocks "First Bite" and toasts it.
  await expect(page.locator('.toast')).toContainText('First Bite', { timeout: 5000 });

  await page.click('#btn-menu');
  await page.click('#btn-progress');
  await expect(page.locator('#overlay-title')).toHaveText('Progress');
  await expect(page.locator('#progress-achievements-count')).toContainText('unlocked');
  await expect(page.locator('.achv.unlocked').first()).toBeVisible();
  // Locked threshold achievements show progress from lifetime stats (1 game so far).
  await expect(page.locator('#achievements-panel')).toContainText('1/10');
  const locked = page.locator('.achv.locked').first();
  await expect(locked).toHaveCSS('opacity', '1');
  expect(await contrastRatio(page, '.achv.locked .achv-desc')).toBeGreaterThanOrEqual(4.5);
  await page.click('#progress-back');
  await expect(page.locator('#overlay-title')).toHaveText('GitSnake');
});

test('compact overlays keep covered header controls out of the focus order', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  expect(await page.locator('.header').evaluate((header) => header.inert)).toBe(true);
  await page.locator('#overlay-title').focus();
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => Boolean(document.activeElement.closest('.header')))).toBe(false);
});

test('Classic hub exposes campaign, Legends archive, and power-ups', async ({ page }) => {
  await page.goto('/');
  await page.click('#btn-classic');
  await expect(page.locator('#overlay-title')).toHaveText('Classic');
  await expect(page.locator('#campaign-list .mode-card')).toHaveCount(5);
  await expect(page.locator('#legends-list .mode-card')).toHaveCount(3);
  await expect(page.locator('[data-campaign="first-commit"]')).toBeEnabled();
  await expect(page.locator('[data-campaign="merge-queue"]')).toBeDisabled();

  await page.click('[data-campaign="first-commit"]');
  await expect(page.locator('#overlay')).toBeHidden();
  await expect(page.locator('#board-label')).toContainText('Campaign');
  await expect(page.locator('#run-brief')).toContainText('Rebase');
  await expect(page.locator('#level-label')).toHaveText('Goal:');
});

test('Daily challenge announces its brief without a Friends setup flow', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#daily-note')).toContainText('New board in');
  await expect(page.locator('#lb-tab-friends')).toHaveCount(0);
  await expect(page.locator('#friends-row')).toHaveCount(0);
  await page.click('#btn-daily');
  await expect(page.locator('#overlay')).toBeHidden({ timeout: 10000 });
  await expect(page.locator('#run-brief')).toBeVisible();
  await expect(page.locator('#run-brief-text')).toContainText('Objective:');
});

test('Locker shows persistent skins, board themes, and trails', async ({ page }) => {
  await page.goto('/');
  await page.click('#btn-locker');
  await expect(page.locator('#overlay-title')).toHaveText('Locker');
  await expect(page.locator('[data-cosmetic-kind="skin"]')).toHaveCount(3);
  await expect(page.locator('[data-cosmetic-kind="board"]')).toHaveCount(3);
  await expect(page.locator('[data-cosmetic-kind="trail"]')).toHaveCount(3);
  await expect(page.locator('[data-cosmetic="github"]')).toHaveClass(/selected/);
  await expect(page.locator('[data-cosmetic="gold"]')).toBeDisabled();
});

test('Legends archive loads a historical contribution year', async ({ page }) => {
  await page.goto('/');
  await page.click('#btn-classic');
  await page.click('[data-legend="torvalds-2016"]');
  await expect(page.locator('#overlay')).toBeHidden({ timeout: 10000 });
  await expect(page.locator('#board-label')).toContainText('@torvalds · 2016');
  await expect(page.locator('#run-brief')).toContainText('historical contribution snapshot');
});

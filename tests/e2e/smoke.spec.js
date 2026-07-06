// End-to-end smoke test: the critical path a unit suite can't see.
// The snake runs into the right wall on its own, so a full run needs no
// keyboard input — click Classic, wait for Game Over, submit, verify.
import { test, expect } from '@playwright/test';

test('classic run: play, die, submit, verified leaderboard entry', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#overlay-title')).toHaveText('GitSnake');

  await page.click('#btn-classic');
  // Unattended, the snake hits the wall in ~2s; death animation follows.
  await expect(page.locator('#overlay-title')).toHaveText('Game Over', { timeout: 20000 });

  await page.fill('#name-input', 'e2e-bot');
  await page.click('#btn-submit');
  await expect(page.locator('#overlay-sub')).toContainText('Verified', { timeout: 10000 });

  // The submitted run appears on the leaderboard and is watchable.
  const row = page.locator('.lb-row.watchable').first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.locator('#board-label')).toContainText('Watching', { timeout: 5000 });

  // Esc exits spectate back to the leaderboard screen, which opens on the
  // all-time board — the run shows there, tagged with the mode it came from.
  await page.keyboard.press('Escape');
  await expect(page.locator('#overlay-title')).toHaveText('Leaderboard');
  await expect(page.locator('#lb-tab-all')).toHaveClass(/active/);
  await expect(page.locator('#leaderboard')).toContainText('Top scores across every mode');
  await expect(page.locator('.lb-row').filter({ hasText: 'e2e-bot' })).toContainText('Classic');
  // Simplified to three tabs: the standalone Classic and Yesterday boards are gone.
  await expect(page.locator('#lb-tab-classic')).toHaveCount(0);
  await expect(page.locator('#lb-tab-yesterday')).toHaveCount(0);
});

test('theme, palette, and pause controls', async ({ page }) => {
  await page.goto('/');

  const initialTheme = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.click('#theme-btn');
  const flippedTheme = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(flippedTheme).not.toBe(initialTheme);

  const greenLevel = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--level-4').trim());
  await page.click('#palette-btn');
  const blueLevel = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--level-4').trim());
  expect(blueLevel).not.toBe(greenLevel);

  // Pause and resume mid-game. Starting is async (session fetch) and now opens
  // with a 3-2-1 countdown, so wait for the overlay to hide and the countdown
  // to finish — the game isn't pausable until it's actually playing.
  await page.click('#btn-classic');
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
  await page.click('#btn-classic');
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
  // Variants live behind a disclosure; open it to reach the toggles.
  await page.click('#variant-summary');
  await page.check('#var-wrap');
  await expect(page.locator('#variant-note')).toBeVisible();
  await expect(page.locator('#variant-summary')).toContainText('wrap');

  await page.click('#btn-classic');
  await expect(page.locator('#board-label')).toContainText('unranked');

  // Un-wrapped, the unattended snake dies in ~2s. With wrap it crosses the
  // edge and keeps going — still playing well past that point.
  await page.waitForTimeout(4500);
  await expect(page.locator('#overlay')).toBeHidden();
});

test('stats panel appears after a finished run', async ({ page }) => {
  await page.goto('/');
  await page.click('#btn-classic');
  await expect(page.locator('#overlay-title')).toHaveText('Game Over', { timeout: 20000 });

  await page.click('#btn-menu');
  await expect(page.locator('#btn-stats')).toBeVisible();
  await page.click('#btn-stats');
  await expect(page.locator('#stats-panel')).toContainText('games played');
  await page.click('#stats-back');
  await expect(page.locator('#overlay-title')).toHaveText('GitSnake');
});

test('finishing a first game unlocks an achievement and opens the panel', async ({ page }) => {
  await page.goto('/');
  await page.click('#btn-classic');
  await expect(page.locator('#overlay-title')).toHaveText('Game Over', { timeout: 20000 });

  // The very first finished run unlocks "First Bite" and toasts it.
  await expect(page.locator('.toast')).toContainText('First Bite', { timeout: 5000 });

  await page.click('#btn-menu');
  await page.click('#btn-achievements');
  await expect(page.locator('#overlay-title')).toHaveText('Achievements');
  await expect(page.locator('#overlay-sub')).toContainText('unlocked');
  await expect(page.locator('.achv.unlocked').first()).toBeVisible();
  // Locked threshold achievements show progress from lifetime stats (1 game so far).
  await expect(page.locator('#achievements-panel')).toContainText('1/10');
  await page.click('#achievements-back');
  await expect(page.locator('#overlay-title')).toHaveText('GitSnake');
});

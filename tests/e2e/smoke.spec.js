// End-to-end smoke test: the critical path a unit suite can't see.
// The snake runs into the right wall on its own, so a full run needs no
// keyboard input — click Classic, wait for Game Over, submit, verify.
import { test, expect } from '@playwright/test';

test('classic run: play, die, submit, verified leaderboard entry', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#overlay-title')).toHaveText('GitHub Snake');

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

  // Esc exits spectate back to the leaderboard screen.
  await page.keyboard.press('Escape');
  await expect(page.locator('#overlay-title')).toHaveText('Leaderboard');
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

  // Pause and resume mid-game. Starting is async (session fetch), so wait
  // for the overlay to actually hide before pausing.
  await page.click('#btn-classic');
  await expect(page.locator('#overlay')).toBeHidden();
  await page.keyboard.press(' ');
  await expect(page.locator('#overlay-title')).toHaveText('Paused');
  await page.click('#btn-resume');
  await expect(page.locator('#overlay')).toBeHidden();
});

test('graph-mode deep link primes the username', async ({ page }) => {
  await page.goto('/?user=octocat');
  await expect(page.locator('#username-input')).toHaveValue('octocat');
  await expect(page.locator('#overlay-sub')).toContainText('challenged');
});

test('wrap-walls variant plays unranked and survives the edge', async ({ page }) => {
  await page.goto('/');
  await page.check('#var-wrap');
  await expect(page.locator('#variant-note')).toBeVisible();

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
  await expect(page.locator('#overlay-title')).toHaveText('GitHub Snake');
});

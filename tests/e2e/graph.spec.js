// Graph-mode end-to-end. The server's real contribution fetcher hits GitHub, so
// these rely on the SNAKE_FAKE_CONTRIBS hatch (set on the dev:api webServer in
// playwright.config.js), which serves a deterministic synthetic year for any
// username. The snake runs into the right wall on its own, so — like the
// classic smoke test — a full graph run needs no keyboard input.
import { test, expect } from '@playwright/test';

async function startGraphRun(page) {
  await page.goto('/?user=octocat');
  // The deep link reveals the username form and primes it; submit to play.
  await expect(page.locator('#username-input')).toHaveValue('octocat');
  await page.locator('#user-row button[type="submit"]').click();
  await expect(page.locator('#overlay')).toBeHidden({ timeout: 10000 });
}

test('graph run: play a synthetic calendar, submit, and see it on the Graph tab', async ({ page }) => {
  await startGraphRun(page);

  // Graph mode's HUD swaps the "Level:" readout for a "Days:" days-eaten counter.
  await expect(page.locator('#level-label')).toHaveText('Days:');
  await expect(page.locator('#level')).toContainText('/');

  // Unattended, the snake hits the right wall → the run ends and the submit
  // row appears (the title may read "Game Over" or "New personal best!").
  await expect(page.locator('#name-input')).toBeVisible({ timeout: 25000 });

  // Unique name so the "me" row is unambiguous regardless of prior scores.
  const player = `graph-${Date.now().toString(36)}`;
  await page.fill('#name-input', player);
  await page.click('#btn-submit');
  await expect(page.locator('#overlay-sub')).toContainText('Verified', { timeout: 10000 });
  await expect(page.locator('#overlay-sub')).toContainText('octocat');

  // Graph standings also appear directly with the verified result.
  await expect(page.locator('#leaderboard')).toContainText('Graph · @octocat');
  await expect(page.locator('.lb-row.me')).toContainText(player);
});

test('graph board engages the follow-camera on a phone viewport without page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await startGraphRun(page);
  await expect(page.locator('#level-label')).toHaveText('Days:');

  const m = await page.evaluate(() => {
    const c = document.getElementById('game');
    return {
      backingW: c.width, // canvas backing-store px (attribute)
      cssW: c.getBoundingClientRect().width,
      dpr: window.devicePixelRatio || 1,
      innerW: window.innerWidth,
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    };
  });

  // The 52-column board is far wider than the phone: the canvas must fit on
  // screen and the page must not scroll sideways.
  expect(m.cssW).toBeLessThanOrEqual(m.innerW);
  expect(m.scrollW).toBeLessThanOrEqual(m.clientW + 1); // +1 for sub-pixel rounding

  // Follow-camera (not whole-board shrink): the backing store holds only a
  // viewport-width slice at full-size cells, so backingW ≈ viewport·dpr. Fitting
  // the whole 927px-wide board instead would blow the backing past that.
  expect(m.backingW).toBeLessThanOrEqual(m.innerW * m.dpr * 1.1);
});

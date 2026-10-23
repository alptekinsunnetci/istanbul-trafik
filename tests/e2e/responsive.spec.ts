import { expect, test } from '@playwright/test';

test('phone layout: menu, map and toolbar fit without horizontal scrolling', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?e2e');
  await page.locator('#advanced summary').click();
  await page.locator('#seed-input').fill('3');
  await page.locator('[data-district="kadikoy"]').click();
  await expect(page.locator('.dock')).toBeVisible();
  const vw = page.viewportSize()!.width;
  for (const sel of ['.hud', '.dock']) {
    const box = await page.locator(sel).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(vw + 1);
  }
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollW).toBeLessThanOrEqual(vw);
  await page.locator('#btn-run').tap();
  await expect(page.locator('#btn-run')).toHaveAttribute('aria-label', /Devam/);
  await page.screenshot({ path: 'test-results/screens/07-mobile.png' });
  expect(errors).toEqual([]);
});

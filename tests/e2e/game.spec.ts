import { type Page, expect, test } from '@playwright/test';

interface GameState {
  app: string;
  overlay: string;
  time: number;
  vehicles: number;
  spawned: number;
  completed: number;
  roads: number;
  edges: number;
  roadPieces: number;
  upgradeOpen: boolean;
  mode: string | null;
  canUndo: boolean;
  tutorialStep: number;
  cameraMoving: boolean;
  tool: string;
  speed: number;
  visibleVehicles: number;
}

type Api = {
  state(): GameState;
  doorPath(a: number, b: number): { x: number; y: number }[];
  tutorialPair(): number[];
  buildingInfo(i: number): { x: number; y: number; doorDir: number; door: number; cellPx: number } | null;
};

const errors: string[] = [];

function state(page: Page): Promise<GameState> {
  return page.evaluate(() => (window as unknown as { __istanbulTrafik: Api }).__istanbulTrafik.state());
}

async function drawBetween(page: Page, a: number, b: number): Promise<void> {
  // Wait until the camera has settled (it glides when the playable area grows).
  await expect.poll(async () => (await state(page)).cameraMoving).toBe(false);
  const pts = await page.evaluate(
    ([x, y]) => (window as unknown as { __istanbulTrafik: Api }).__istanbulTrafik.doorPath(x, y),
    [a, b] as const,
  );
  expect(pts.length).toBeGreaterThan(1);
  // A weekly reward that opened just now would swallow the drag: let the handler take it first.
  await expect(page.locator('#upgrade-dialog')).toBeHidden();
  const first = pts[0]!;
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(p.x, p.y, { steps: 2 });
  await page.mouse.up();
}

async function startDistrict(page: Page, district = 'kadikoy', seed = '12345'): Promise<void> {
  await page.goto('/?e2e');
  await expect(page.locator('#menu-title')).toHaveText('İstanbul Trafik');
  await page.locator('#advanced summary').click();
  await page.locator('#seed-input').fill(seed);
  await page.locator(`[data-district="${district}"]`).click();
  // The game starts immediately.
  await expect.poll(async () => (await state(page)).app).toBe('playing');
}

test.beforeEach(async ({ page }) => {
  // Weekly rewards may pop up at any time: always take the first one.
  await page.addLocatorHandler(page.locator('#upgrade-dialog'), async () => {
    await page.locator('[data-upgrade="0"]').click();
  });
  errors.length = 0;
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
});

test.afterEach(() => {
  expect(errors, errors.join('\n')).toEqual([]);
});

test('opens the main menu and lists Istanbul districts', async ({ page }) => {
  await page.goto('/?e2e');
  await expect(page).toHaveTitle('İstanbul Trafik');
  for (const name of ['Kadıköy', 'Beşiktaş', 'Üsküdar', 'Fatih', 'Şişli', 'Bakırköy']) {
    await expect(page.locator('.district-card', { hasText: name })).toBeVisible();
  }
  await page.screenshot({ path: 'test-results/screens/01-menu.png' });
});

test('rejects an invalid seed with a visible message', async ({ page }) => {
  await page.goto('/?e2e');
  await page.locator('#advanced summary').click();
  await page.locator('#seed-input').fill('abc');
  await page.locator('[data-district="fatih"]').click();
  await expect(page.locator('#seed-error')).toContainText('Tohum');
  expect((await state(page)).app).toBe('menu');
});

test('draw roads, run traffic, pause, restart', async ({ page }) => {
  // Waits for in-game events (trips, a whole week), which takes a while in a software-rendered browser.
  test.setTimeout(150_000);
  await startDistrict(page);
  await page.screenshot({ path: 'test-results/screens/03-ready.png' });
  const before = await state(page);
  expect(before.roads).toBeGreaterThan(0); // door stubs
  // Building 0 is the workplace; 1–3 are houses of the same colour.
  await drawBetween(page, 1, 0);
  await drawBetween(page, 2, 0);
  await drawBetween(page, 3, 0);
  const drawn = await state(page);
  expect(drawn.roads).toBeGreaterThan(before.roads + 5);
  expect(drawn.edges).toBeGreaterThan(0);
  expect(drawn.roadPieces).toBeLessThan(before.roadPieces);
  await expect(page.locator('#roads-value')).toHaveText(String(drawn.roadPieces));

  // Speed up.
  await page.locator('#btn-speed').click();
  await page.locator('#btn-speed').click();
  expect((await state(page)).speed).toBe(4);
  await expect.poll(async () => (await state(page)).spawned, { timeout: 30_000 }).toBeGreaterThan(0);
  await expect.poll(async () => (await state(page)).visibleVehicles, { timeout: 15_000 }).toBeGreaterThan(0);
  await page.keyboard.press('t');
  await page.screenshot({ path: 'test-results/screens/04-traffic.png' });
  await page.keyboard.press('t');
  await expect.poll(async () => (await state(page)).completed, { timeout: 45_000 }).toBeGreaterThan(0);
  // Close-up for visual review of vehicles and road markings.
  for (let i = 0; i < 3; i++) await page.keyboard.press('+');
  await page.screenshot({ path: 'test-results/screens/04b-closeup.png' });
  await page.keyboard.press('f');

  // Pause: simulation time must stand still.
  await page.locator('#btn-run').click();
  await expect.poll(async () => (await state(page)).app).toBe('paused');
  const t0 = (await state(page)).time;
  await page.waitForTimeout(700);
  expect((await state(page)).time).toBe(t0);
  await page.keyboard.press('i');
  await expect(page.locator('#stats-panel')).toBeVisible();
  await expect(page.locator('#stats-panel')).toContainText('Tamamlanan yolculuk');
  await page.screenshot({ path: 'test-results/screens/05-paused-stats.png' });

  // Resume, then restart via the confirm dialog.
  await page.locator('#btn-run').click();
  await expect.poll(async () => (await state(page)).time).toBeGreaterThan(t0);
  await page.locator('#btn-menu').click();
  await page.locator('#btn-pause-restart').click();
  await page.locator('#btn-confirm').click();
  await expect.poll(async () => (await state(page)).app).toBe('playing');
  const fresh = await state(page);
  // The new game starts immediately (still at 4×), so only check that the clock was reset.
  expect(fresh.time).toBeLessThan(Math.min(15, t0));
  expect(fresh.vehicles).toBe(0);
  expect(fresh.completed).toBe(0);
  expect(fresh.roads).toBe(before.roads);
});

test('inspect a vehicle shows its route details', async ({ page }) => {
  // Waits for in-game events (trips, a whole week), which takes a while in a software-rendered browser.
  test.setTimeout(150_000);
  await startDistrict(page, 'bakirkoy', '777');
  await drawBetween(page, 0, 1);
  await drawBetween(page, 0, 3);
  await expect.poll(async () => (await state(page)).visibleVehicles, { timeout: 30_000 }).toBeGreaterThan(0);
  // Tap along the first road until a vehicle is hit (a tap inspects instead of drawing).
  const pts = await page.evaluate(() =>
    (window as unknown as { __istanbulTrafik: Api }).__istanbulTrafik.doorPath(0, 1),
  );
  let found = false;
  for (let attempt = 0; attempt < 40 && !found; attempt++) {
    for (const p of pts) {
      await page.mouse.click(p.x, p.y);
      if (await page.locator('#inspector').isVisible()) {
        const title = await page.locator('#inspector-title').textContent();
        if (title && /#\d+/.test(title)) {
          found = true;
          break;
        }
      }
    }
    if (!found) await page.waitForTimeout(150);
  }
  expect(found).toBe(true);
  await expect(page.locator('#inspector')).toContainText('Nereye');
  await page.screenshot({ path: 'test-results/screens/06-inspect.png' });
});

test('settings open, save and persist across reloads', async ({ page }) => {
  await page.goto('/?e2e');
  await page.locator('#btn-menu-settings').click();
  await expect(page.locator('#settings-dialog')).toBeVisible();
  // The faint grid is on by default.
  await expect(page.locator('#set-grid')).toBeChecked();
  await page.locator('#set-grid').uncheck();
  await page.locator('#set-contrast').check();
  await page.locator('#btn-save-settings').click();
  await expect(page.locator('#settings-dialog .field-status')).toHaveText('Ayarlar kaydedildi.');
  await page.locator('#btn-close-settings').click();
  await page.reload();
  await page.locator('#btn-menu-settings').click();
  await expect(page.locator('#set-grid')).not.toBeChecked();
  await expect(page.locator('#set-contrast')).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings-dialog')).toHaveCount(0);
});

test('help opens from the menu and keyboard shortcuts select tools', async ({ page }) => {
  await startDistrict(page, 'sisli', '5');
  await page.locator('#btn-menu').click();
  await page.locator('#btn-pause-help').click();
  await expect(page.locator('#help-dialog')).toContainText('Kontroller');
  await page.keyboard.press('Escape');
  await expect(page.locator('#help-dialog')).toHaveCount(0);
  await page.keyboard.press('3');
  expect((await state(page)).tool).toBe('erase');
  await expect(page.locator('[data-tool="erase"]')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('3');
  expect((await state(page)).tool).toBe('road');
});

test('saved game can be continued from the main menu', async ({ page }) => {
  await startDistrict(page, 'uskudar', '99');
  await drawBetween(page, 0, 1);
  const roads = (await state(page)).roads;
  await page.locator('#btn-menu').click();
  await page.locator('#btn-to-menu').click();
  await expect(page.locator('#btn-continue')).toBeVisible();
  await page.reload();
  await page.locator('#btn-continue').click();
  await expect.poll(async () => (await state(page)).app).toBe('paused');
  expect((await state(page)).roads).toBe(roads);
});

test('right-drag erases roads and returns the pieces', async ({ page }) => {
  await startDistrict(page, 'kadikoy', '4');
  await drawBetween(page, 1, 0);
  const drawn = await state(page);
  const pts = await page.evaluate(() =>
    (window as unknown as { __istanbulTrafik: Api }).__istanbulTrafik.doorPath(1, 0),
  );
  // Erase the middle part of the road with the right mouse button.
  const mid = pts.slice(2, -2);
  await page.mouse.move(mid[0]!.x, mid[0]!.y);
  await page.mouse.down({ button: 'right' });
  for (const p of mid.slice(1)) await page.mouse.move(p.x, p.y, { steps: 2 });
  await page.mouse.up({ button: 'right' });
  const erased = await state(page);
  expect(erased.roads).toBeLessThan(drawn.roads);
  expect(erased.roadPieces).toBeGreaterThan(drawn.roadPieces);
});

test('a weekly reward is offered and choosing one adds pieces', async ({ page }) => {
  // Waits for in-game events (trips, a whole week), which takes a while in a software-rendered browser.
  test.setTimeout(150_000);
  await page.removeLocatorHandler(page.locator('#upgrade-dialog'));
  await startDistrict(page, 'kadikoy', '12345');
  await drawBetween(page, 1, 0);
  await drawBetween(page, 2, 0);
  await drawBetween(page, 3, 0);
  await page.locator('#btn-speed').click();
  await page.locator('#btn-speed').click();
  await expect(page.locator('#upgrade-dialog')).toBeVisible({ timeout: 40_000 });
  await expect(page.locator('.upgrade-card')).toHaveCount(2);
  const time = (await state(page)).time;
  await page.waitForTimeout(500);
  expect((await state(page)).time).toBe(time); // the game waits for the choice
  await page.screenshot({ path: 'test-results/screens/08-reward.png' });
  await page.locator('[data-upgrade="0"]').click();
  await expect(page.locator('#upgrade-dialog')).toHaveCount(0);
  await expect.poll(async () => (await state(page)).time).toBeGreaterThan(time);
  await page.screenshot({ path: 'test-results/screens/09-week2.png' });
});

test('guided tutorial: connect the highlighted house, then the others', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/?e2e');
  await page.locator('#btn-tutorial').click();
  await expect(page.locator('#coach')).toBeVisible();
  await expect(page.locator('#coach')).toContainText('1/4');
  let s = await state(page);
  expect(s.app).toBe('ready'); // the clock waits for the first road
  expect(s.mode).toBe('rahat');
  const pair = await page.evaluate(() =>
    (window as unknown as { __istanbulTrafik: Api }).__istanbulTrafik.tutorialPair(),
  );
  const work = pair[pair.length - 1]!;
  await page.screenshot({ path: 'test-results/screens/10-tutorial.png' });
  await drawBetween(page, pair[0]!, work);
  await expect(page.locator('#coach')).toContainText('2/4');
  s = await state(page);
  expect(s.app).toBe('playing');
  await page.locator('#btn-speed').click();
  await page.locator('#btn-speed').click();
  await expect(page.locator('#coach')).toContainText('3/4', { timeout: 60_000 });
  for (const house of pair.slice(1, -1)) await drawBetween(page, house, work);
  await expect(page.locator('#coach')).toContainText('4/4');
  await page.locator('#btn-coach-next').click();
  await expect(page.locator('#coach')).toBeHidden();
  expect((await state(page)).tutorialStep).toBe(0);
});

test('undo removes the last road and returns its pieces', async ({ page }) => {
  await startDistrict(page, 'kadikoy', '8');
  const before = await state(page);
  expect(before.canUndo).toBe(false);
  await expect(page.locator('#btn-undo')).toBeDisabled();
  await drawBetween(page, 1, 0);
  const drawn = await state(page);
  expect(drawn.canUndo).toBe(true);
  await page.locator('#btn-undo').click();
  const undone = await state(page);
  // The city may grow meanwhile (new door cells), so compare pieces rather than road cells.
  expect(undone.roadPieces).toBe(before.roadPieces);
  expect(undone.roads).toBeLessThan(drawn.roads);
  expect(undone.canUndo).toBe(false);
  // Keyboard shortcut works too.
  await drawBetween(page, 2, 0);
  expect((await state(page)).roadPieces).toBeLessThan(before.roadPieces);
  await page.keyboard.press('Control+z');
  expect((await state(page)).roadPieces).toBe(before.roadPieces);
});

test('difficulty mode can be chosen and is remembered', async ({ page }) => {
  await page.goto('/?e2e');
  await expect(page.locator('[data-mode="normal"]')).toHaveAttribute('aria-checked', 'true');
  await page.locator('[data-mode="rahat"]').click();
  await expect(page.locator('[data-mode="rahat"]')).toHaveAttribute('aria-checked', 'true');
  await page.reload();
  await expect(page.locator('[data-mode="rahat"]')).toHaveAttribute('aria-checked', 'true');
  await page.locator('[data-district="bakirkoy"]').click();
  await expect.poll(async () => (await state(page)).mode).toBe('rahat');
});

test('dragging out of a house on another side turns its entrance', async ({ page }) => {
  await startDistrict(page, 'kadikoy', '2026');
  await page.locator('#btn-run').click(); // pause: nothing should change under the pointer
  await expect.poll(async () => (await state(page)).cameraMoving).toBe(false);
  const info = await page.evaluate(() =>
    (window as unknown as { __istanbulTrafik: Api }).__istanbulTrafik.buildingInfo(1),
  );
  expect(info).not.toBeNull();
  const { x, y, doorDir, cellPx } = info!;
  // Drag away from the entrance: opposite direction (N=0, E=1, S=2, W=3).
  const dx = [0, 1, 0, -1][(doorDir + 2) % 4]!;
  const dy = [-1, 0, 1, 0][(doorDir + 2) % 4]!;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let k = 1; k <= 3; k++) await page.mouse.move(x + dx * k * cellPx, y + dy * k * cellPx, { steps: 3 });
  await page.mouse.up();
  const after = await page.evaluate(() =>
    (window as unknown as { __istanbulTrafik: Api }).__istanbulTrafik.buildingInfo(1),
  );
  expect(after!.doorDir).toBe((doorDir + 2) % 4);
  await page.screenshot({ path: 'test-results/screens/11-turned-entrance.png' });
});

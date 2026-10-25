import { expect, test } from '@playwright/test';
import { findValidPlacement, hud, ownCount, screenOf, setSpeed, waitReady, watchErrors } from './helpers';

test('touch interface: select, deploy, build, place, command', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
  await page.getByText('Skirmish vs AI').tap();
  await page.getByText('Deploy ▶').tap();
  await waitReady(page);
  const mcv = await screenOf(page, 'mcv');
  await page.touchscreen.tap(mcv!.x, mcv!.y);
  await page.getByTestId('deploy').tap();
  await expect.poll(() => ownCount(page, 'hq'), { timeout: 30_000 }).toBe(1);
  await setSpeed(page, 8);
  await expect(page.getByTestId('build-power')).not.toHaveClass(/disabled/, { timeout: 30_000 });
  await page.getByTestId('build-power').tap();
  await expect(page.getByTestId('build-power').getByText('READY')).toBeVisible({ timeout: 45_000 });
  await page.getByTestId('build-power').tap();
  expect(await findValidPlacement(page, (x, y) => page.touchscreen.tap(x, y))).toBe(true);
  await page.getByTestId('confirm-place').tap();
  await expect.poll(async () => (await hud(page)).power[0], { timeout: 30_000 }).toBeGreaterThanOrEqual(110);

  // Tap a unit to select it, tap empty ground to move it.
  // Bring the tank to the middle of the playfield (phones have little room around the HUD).
  await page.evaluate(() => {
    const c = (window as unknown as { __iron: { world: { ents: Map<number, { type: string; owner: number; x: number; y: number }> }; camera: { centerOn(x: number, y: number): void } } }).__iron;
    const t = [...c.world.ents.values()].find((e) => e.type === 'lighttank' && e.owner === 0)!;
    c.camera.centerOn(t.x, t.y);
  });
  await page.waitForTimeout(200);
  const tank = await screenOf(page, 'lighttank');
  await page.touchscreen.tap(tank!.x, tank!.y);
  await expect.poll(async () => (await hud(page)).selection.count).toBe(1);
  const target = await page.evaluate(([sx, sy]) => {
    const c = (window as unknown as { __iron: { camera: { screenToWorld(x: number, y: number): { x: number; y: number } }; world: { w: number; map: { terrain: Uint8Array }; ore: Uint16Array; pick(x: number, y: number, r: number): unknown } } }).__iron;
    const walkable = (x: number, y: number) => { const i = Math.floor(y / 32) * c.world.w + Math.floor(x / 32); return [0, 1, 5].includes(c.world.map.terrain[i]) && c.world.ore[i] === 0; };
    for (const [dx, dy] of [[-110, 0], [0, 100], [110, 0], [0, -100], [-80, 80], [80, -80]]) {
      const p = c.camera.screenToWorld(sx + dx, sy + dy);
      if (!c.world.pick(p.x, p.y, 16) && walkable(p.x, p.y) && document.elementFromPoint(sx + dx, sy + dy)?.tagName === 'CANVAS' && sy + dy > 60 && sx + dx > 20) return { x: sx + dx, y: sy + dy, wx: p.x, wy: p.y };
    }
    return null;
  }, [tank!.x, tank!.y]);
  await page.touchscreen.tap(target!.x, target!.y);
  await expect.poll(async () => {
    const t = await screenOf(page, 'lighttank');
    return Math.hypot(t!.wx - target!.wx, t!.wy - target!.wy);
  }, { timeout: 30_000 }).toBeLessThan(24);
  expect(errors).toEqual([]);
});

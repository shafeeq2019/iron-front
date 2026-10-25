import { expect, type Page } from '@playwright/test';

/** Collects console errors and uncaught exceptions for a page. */
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

type Ctrl = {
  world: { ents: Map<number, { type: string; owner: number; x: number; y: number; isBuilding: boolean }>; playerId: number };
  camera: { worldToScreen(x: number, y: number): { x: number; y: number }; screenToWorld(x: number, y: number): { x: number; y: number } };
  conn: { setSpeed(n: number): void };
  hud: { get(): { credits: number; power: [number, number]; placementValid: boolean; selection: { count: number } } };
  placeValid: boolean;
};

/** Screen position of the first own entity of a type (via the debug handle). */
export async function screenOf(page: Page, type: string) {
  return page.evaluate((type) => {
    const c = (window as unknown as { __iron: Ctrl }).__iron;
    const e = [...c.world.ents.values()].find((e) => e.type === type && e.owner === c.world.playerId);
    if (!e) return null;
    return { ...c.camera.worldToScreen(e.x, e.y), wx: e.x, wy: e.y };
  }, type);
}

export async function hud(page: Page) {
  return page.evaluate(() => (window as unknown as { __iron: Ctrl }).__iron.hud.get());
}

export async function setSpeed(page: Page, n: number) {
  await page.evaluate((n) => (window as unknown as { __iron: Ctrl }).__iron.conn.setSpeed(n), n);
}

export async function ownCount(page: Page, type: string) {
  return page.evaluate((type) => {
    const c = (window as unknown as { __iron: Ctrl }).__iron;
    return [...c.world.ents.values()].filter((e) => e.type === type && e.owner === c.world.playerId).length;
  }, type);
}

/** Moves the placement ghost around the HQ until the preview is valid. */
export async function findValidPlacement(page: Page, tap: (x: number, y: number) => Promise<void>) {
  const hq = await screenOf(page, 'hq');
  expect(hq).not.toBeNull();
  for (const [dx, dy] of [[-120, -40], [-120, 60], [130, 60], [0, -130], [-170, 0], [170, -60], [0, 140], [-140, 130]]) {
    await tap(hq!.x + dx, hq!.y + dy);
    await page.waitForTimeout(200);
    if (await page.evaluate(() => (window as unknown as { __iron: Ctrl }).__iron.placeValid)) return true;
  }
  return false;
}

/** Waits until the 3D renderer has finished its loading phase (shader compilation). */
export async function waitReady(page: Page) {
  await page.waitForFunction(() => {
    const c = (window as unknown as { __iron?: { hud: { get(): { loading: boolean } } } }).__iron;
    return !!c && !c.hud.get().loading;
  }, null, { timeout: 120_000 });
  await page.waitForTimeout(500);
}

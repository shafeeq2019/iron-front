import { expect, test } from '@playwright/test';
import { findValidPlacement, hud, ownCount, screenOf, setSpeed, waitReady, watchErrors } from './helpers';

test('menu → skirmish → deploy → build and place → train units', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page.getByText('IRON FRONT')).toBeVisible();
  await page.getByText('Skirmish vs AI').click();
  await page.getByText('Deploy ▶').click();
  await expect(page.getByTestId('game-canvas')).toBeVisible();
  await waitReady(page);

  // Select and deploy the MCV.
  const mcv = await screenOf(page, 'mcv');
  await page.mouse.click(mcv!.x, mcv!.y);
  await page.getByTestId('deploy').click();
  await expect.poll(() => ownCount(page, 'hq'), { timeout: 30_000 }).toBe(1);
  await setSpeed(page, 8);
  await expect(page.getByTestId('build-power')).not.toHaveClass(/disabled/, { timeout: 30_000 });

  // Build a power plant and place it.
  const startCredits = (await hud(page)).credits;
  await page.getByTestId('build-power').click();
  await expect.poll(async () => (await hud(page)).credits).toBe(startCredits - 800);
  await expect(page.getByTestId('build-power').getByText('READY')).toBeVisible({ timeout: 45_000 });
  await page.getByTestId('build-power').click();
  expect(await findValidPlacement(page, (x, y) => page.mouse.move(x, y))).toBe(true);
  const ghost = await page.evaluate(() => (window as unknown as { __iron: { mouse: { x: number; y: number } } }).__iron.mouse);
  await page.mouse.click(ghost.x, ghost.y);
  await expect.poll(async () => (await hud(page)).power[0], { timeout: 30_000 }).toBeGreaterThanOrEqual(110);

  // Barracks → rifleman.
  await expect(page.getByTestId('build-barracks')).not.toHaveClass(/disabled/, { timeout: 30_000 });
  await page.getByTestId('build-barracks').click();
  await expect(page.getByTestId('build-barracks').getByText('READY')).toBeVisible({ timeout: 45_000 });
  await page.getByTestId('build-barracks').click();
  expect(await findValidPlacement(page, (x, y) => page.mouse.move(x, y))).toBe(true);
  const g2 = await page.evaluate(() => (window as unknown as { __iron: { mouse: { x: number; y: number } } }).__iron.mouse);
  await page.mouse.click(g2.x, g2.y);
  await expect.poll(() => ownCount(page, 'barracks'), { timeout: 30_000 }).toBe(1);
  const rifles = await ownCount(page, 'rifle');
  await page.getByText('Infantry', { exact: true }).click();
  await expect(page.getByTestId('build-rifle')).not.toHaveClass(/disabled/, { timeout: 30_000 });
  await page.getByTestId('build-rifle').click();
  await expect.poll(() => ownCount(page, 'rifle'), { timeout: 15_000 }).toBe(rifles + 1);
  expect(errors).toEqual([]);
});

test('AI opponent builds a base and the match can end', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?demo=1&map=frostbite');
  await expect(page.getByTestId('game-canvas')).toBeVisible();
  await waitReady(page);
  await setSpeed(page, 16);
  // The AI-controlled player deploys and builds structures.
  await expect.poll(() => ownCount(page, 'refinery'), { timeout: 90_000 }).toBeGreaterThan(0);
  // Surrender through the pause menu shows the result screen.
  await page.getByRole('button', { name: /Menu/ }).click();
  await page.getByText('Surrender', { exact: true }).click();
  await page.getByText('Confirm surrender').click();
  await expect(page.getByTestId('result-title')).toHaveText('DEFEAT', { timeout: 30_000 });
  expect(errors).toEqual([]);
});

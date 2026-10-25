import { expect, test } from '@playwright/test';
import { ownCount, screenOf, waitReady, watchErrors } from './helpers';

test('two browsers create, join, play and finish an online match', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const A = await ctxA.newPage();
  const B = await ctxB.newPage();
  const errA = watchErrors(A), errB = watchErrors(B);

  await A.goto('/');
  await A.getByText('Multiplayer').click();
  await A.getByLabel('Your name').fill('Alice');
  await A.getByText('Create Room').click();
  const code = (await A.getByTestId('room-code').textContent())!.trim();
  expect(code).toMatch(/^[A-Z0-9]{5}$/);

  // Bob joins through the invite link.
  const invite = await A.getByLabel('Invite link').inputValue();
  await B.goto(invite);
  await B.getByLabel('Your name').fill('Bob');
  await B.getByText('Join Room').click();
  await expect(B.getByTestId('room-code')).toHaveText(code);
  await expect(A.getByTestId('lobby-slot')).toHaveCount(2);
  await B.getByText('Ready ✔').click();
  await A.getByText('Start Match ▶').click();
  await expect(A.getByTestId('game-canvas')).toBeVisible();
  await expect(B.getByTestId('game-canvas')).toBeVisible();
  await Promise.all([waitReady(A), waitReady(B)]);

  // Each side controls only its own forces and cannot see the enemy base.
  await expect.poll(() => ownCount(A, 'mcv')).toBe(1);
  const enemyVisible = await A.evaluate(() => {
    const c = (window as unknown as { __iron: { world: { ents: Map<number, { owner: number }>; playerId: number } } }).__iron;
    return [...c.world.ents.values()].filter((e) => e.owner >= 0 && e.owner !== c.world.playerId).length;
  });
  expect(enemyVisible).toBe(0);
  const mcv = await screenOf(A, 'mcv');
  await A.mouse.click(mcv!.x, mcv!.y);
  await A.getByTestId('deploy').click();
  await expect.poll(() => ownCount(A, 'hq'), { timeout: 30_000 }).toBe(1);

  // Reload mid-match rejoins the same game.
  await B.reload();
  await expect(B.getByTestId('game-canvas')).toBeVisible({ timeout: 45_000 });
  await waitReady(B);
  await expect.poll(() => ownCount(B, 'mcv'), { timeout: 30_000 }).toBe(1);

  await B.getByRole('button', { name: /Menu/ }).click();
  await B.getByText('Surrender', { exact: true }).click();
  await B.getByText('Confirm surrender').click();
  await expect(A.getByTestId('result-title')).toHaveText('VICTORY', { timeout: 30_000 });
  await expect(B.getByTestId('result-title')).toHaveText('DEFEAT', { timeout: 30_000 });
  await A.getByText('Back to lobby (rematch)').click();
  await expect(A.getByTestId('room-code')).toHaveText(code);
  expect(errA).toEqual([]);
  expect(errB).toEqual([]);
});

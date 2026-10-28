import { expect, test } from '@playwright/test';
import { ACCOUNTS, FORMER_CLIENT, login } from './helpers';

// Sign-in is staff-only in the Admin app. Clients never had a password here to begin with in the User app;
// see request-form.spec.ts and review-flow.spec.ts for how they submit, track and approve a request.

test('a wrong password shows an error and stays on the sign-in page', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email address').fill(ACCOUNTS.lead.email);
  await page.getByLabel('Password', { exact: true }).fill('not-the-password');
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('header.app-header')).toHaveCount(0);
});

test('a lead signs in, sees the board and signs out', async ({ page }) => {
  await login(page, ACCOUNTS.lead);
  await expect(page.getByRole('heading', { name: 'Visual Board', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(page.getByLabel('Email address')).toBeVisible();
});

test('a Requester-role account (a former client) cannot sign in, correct password or not', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email address').fill(FORMER_CLIENT.email);
  await page.getByLabel('Password', { exact: true }).fill(FORMER_CLIENT.password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('header.app-header')).toHaveCount(0);
});

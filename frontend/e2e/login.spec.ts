import { expect, test } from '@playwright/test';
import { ACCOUNTS, login } from './helpers';

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
  await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible();
  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(page.getByLabel('Email address')).toBeVisible();
});

test('a client sees only their requests and notifications: no sidebar, calendar or search', async ({ page }) => {
  await login(page, ACCOUNTS.client);
  await expect(page).toHaveURL(/client-portal/);
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Kanban Board' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Calendar' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Search the workspace/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Notifications/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New request' })).toBeVisible();
  await page.goto('/calendar');                                  // no calendar for clients: back to their requests
  await expect(page).toHaveURL(/client-portal/);
});

test('the sign-in page links to the public request form', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Submit a request' }).click();
  await expect(page.getByRole('heading', { name: /Request for Creative/ })).toBeVisible();
});

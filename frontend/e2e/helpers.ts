import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const API = 'http://127.0.0.1:8765';

export const ACCOUNTS = {
  lead: { email: 'lead@mccia.in', password: 'mccia123' },
  designer: { email: 'alice@mccia.in', password: 'mccia123' },
  client: { email: 'client@tata.com', password: 'client123' },
};

export async function login(page: Page, who: { email: string; password: string }) {
  await page.goto('/');
  await page.getByLabel('Email address').fill(who.email);
  await page.getByLabel('Password', { exact: true }).fill(who.password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page.locator('header.app-header')).toBeVisible();   // the top bar is on every signed-in page (clients have no sidebar)
}

/** Bearer token for API setup calls. */
export async function token(request: APIRequestContext, who: { email: string; password: string }) {
  const res = await request.post(`${API}/api/auth/token`, { form: { username: who.email, password: who.password } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).access_token as string;
}

export function dateInDays(n: number) {
  const d = new Date(Date.now() + n * 86_400_000);
  return d.toISOString().slice(0, 10);
}

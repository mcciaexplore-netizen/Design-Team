import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { ACCOUNTS, API, USER_BASE, dateInDays, login, token } from './helpers';

// A 5 MB PNG: over Vercel's 4.5 MB body limit, so it has to go up in pieces and come back down as byte ranges.
const PNG_HEAD = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const BIG = Buffer.concat([PNG_HEAD, Buffer.alloc(5 * 1024 * 1024, 7)]);

test('a 5 MB file sent with the public form reaches the ticket and downloads intact', async ({ page, browser, request }) => {
  const pieces: string[] = [];
  page.on('request', r => { if (r.url().includes('/api/uploads/')) pieces.push(r.method()); });

  await page.goto(`${USER_BASE}/request`);
  await page.getByLabel('Name *', { exact: true }).fill('Big File');
  await page.getByLabel('Email *').fill('big.file.e2e@example.com');
  await page.getByLabel('Event name *').fill('E2E Big Poster');
  await page.getByLabel('Event / Workshop date *').fill(dateInDays(30));
  await page.getByLabel('Expected delivery date *').fill(dateInDays(5));
  await page.getByRole('checkbox', { name: 'Flyer (Email / Print)', exact: true }).check();
  await page.getByLabel('Size *', { exact: true }).selectOption('A4');
  await page.getByLabel('Where will it be shared? *').selectOption('Print');
  await page.getByLabel(/Attach files/).setInputFiles({ name: 'poster.png', mimeType: 'image/png', buffer: BIG });
  await page.getByRole('button', { name: 'Submit request' }).click();
  await expect(page.getByRole('status')).toContainText('Request received');
  expect(pieces).toEqual(['PUT', 'PUT']);   // 5 MB in 3 MB pieces

  // It waits for a Design Lead to accept it before it enters the workflow and appears on the public board.
  const lead = await token(request, ACCOUNTS.lead);
  const headers = { Authorization: `Bearer ${lead}` };
  const tickets = await (await request.get(`${API}/api/tickets`, { headers })).json();
  const pending = tickets.find((t: { title: string }) => t.title === 'E2E Big Poster - Flyer (Email / Print)');
  expect(pending.status).toBe('Pending Review');
  await request.post(`${API}/api/tickets/${pending.id}/accept`, { headers });

  // The public board shows it without signing in, in the User app.
  await page.goto(`${USER_BASE}/`);
  await expect(page.getByRole('heading', { name: 'Design requests' })).toBeVisible();
  await expect(page.getByText('E2E Big Poster - Flyer (Email / Print)')).toBeVisible();
  await expect(page.getByText('big.file.e2e@example.com')).toHaveCount(0);

  // The lead finds the file on the ticket and downloads exactly what was sent.
  const leadPage = await browser.newPage();
  await login(leadPage, ACCOUNTS.lead);
  await leadPage.getByText('E2E Big Poster - Flyer (Email / Print)').first().click();
  await expect(leadPage.getByText('poster.png')).toBeVisible();
  const [download] = await Promise.all([
    leadPage.waitForEvent('download'),
    leadPage.getByRole('button', { name: 'Download poster.png' }).click(),
  ]);
  const saved = await readFile((await download.path())!);
  expect(saved.length).toBe(BIG.length);
  expect(saved.equals(BIG)).toBe(true);
});

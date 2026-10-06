import { expect, test } from '@playwright/test';
import { ACCOUNTS, API, login, token } from './helpers';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');

test('the designer uploads once; the client is notified, reviews in the portal, asks for changes, then approves the redo', async ({ page, browser, request }) => {
  const client = await token(request, ACCOUNTS.client);
  const types = await (await request.get(`${API}/api/design-types`, { headers: { Authorization: `Bearer ${client}` } })).json();
  const ticket = await (await request.post(`${API}/api/tickets`, {
    headers: { Authorization: `Bearer ${client}` },
    data: { title: 'E2E one-step approval', brief: 'Poster', design_type_id: types[0].id, type_specific_fields: {} },
  })).json();

  // Designer: upload only. No comment, no separate "send" step.
  await login(page, ACCOUNTS.designer);
  await page.goto(`/tickets/${ticket.id}`);
  await page.getByRole('tab', { name: 'Proofs & approval' }).click();
  await expect(page.getByLabel('Send to the client for approval when uploaded')).toBeChecked();
  await page.getByLabel('Choose proof file').setInputFiles({ name: 'poster-v1.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('status').first()).toContainText('sent to the client for approval');

  // Client: notified, opens the design from the bell.
  const clientPage = await (await browser.newContext()).newPage();
  await login(clientPage, ACCOUNTS.client);
  await clientPage.getByRole('button', { name: /^Notifications/ }).click();
  const note = clientPage.getByRole('dialog', { name: 'Notifications' }).getByRole('button', { name: /sent a design for your review/ }).first();
  await expect(note).toBeVisible();
  await note.click();
  await expect(clientPage).toHaveURL(new RegExp(`/tickets/${ticket.id}$`));
  await clientPage.getByRole('tab', { name: 'Proofs & approval' }).click();
  await expect(clientPage.getByText('Your review is needed')).toBeVisible();

  // ...and replies with changes. That opens the next version, V2, as a new ticket.
  await clientPage.getByRole('button', { name: 'Request changes' }).first().click();
  await clientPage.getByLabel('What should we change?').fill('Please make the headline bigger');
  await clientPage.getByRole('button', { name: 'Send feedback' }).click();
  await expect(clientPage.getByText('your feedback was sent')).toBeVisible();
  const v2Link = clientPage.getByRole('link', { name: /-V2$/ });
  await expect(v2Link).toBeVisible();
  await v2Link.click();
  await expect(clientPage).toHaveURL(/\/tickets\/\d+$/);
  const v2Id = Number(clientPage.url().split('/').pop());
  expect(v2Id).not.toBe(ticket.id);

  // Designer: V2 is theirs; the upload goes out automatically and the client hears about it.
  await page.goto(`/tickets/${v2Id}`);
  await page.getByRole('tab', { name: 'Proofs & approval' }).click();
  await page.getByLabel('Choose proof file').setInputFiles({ name: 'poster-v2.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('status').first()).toContainText('was sent to the client');

  await clientPage.reload();
  await clientPage.getByRole('button', { name: /^Notifications/ }).click();
  await expect(clientPage.getByRole('dialog', { name: 'Notifications' }).getByText(/sent a design for your review.*-V2/).first()).toBeVisible();
  await clientPage.keyboard.press('Escape');
  await clientPage.getByRole('tab', { name: 'Proofs & approval' }).click();
  await expect(clientPage.getByRole('heading', { name: /^Changes requested on DF-/ })).toBeVisible();   // V1's feedback travels with V2
  await clientPage.getByRole('button', { name: 'Approve' }).first().click();
  await clientPage.getByRole('button', { name: 'Confirm approval' }).click();
  await expect(clientPage.getByText('the design is approved')).toBeVisible();

  const lead = await token(request, ACCOUNTS.lead);
  const after = await (await request.get(`${API}/api/tickets`, { headers: { Authorization: `Bearer ${lead}` } })).json();
  const byId = (id: number) => after.find((t: { id: number }) => t.id === id);
  expect(byId(v2Id).status).toBe('Delivered');
  expect(byId(v2Id).parent_id).toBe(ticket.id);
  expect(byId(ticket.id).status).toBe('Revision Requested');   // V1 is finished; V2 carried the work on
});

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

  // ...and replies with changes.
  await clientPage.getByRole('button', { name: 'Request changes' }).first().click();
  await clientPage.getByLabel('What should we change?').fill('Please make the headline bigger');
  await clientPage.getByRole('button', { name: 'Send feedback' }).click();
  await expect(clientPage.getByText('your feedback was sent')).toBeVisible();

  // Designer: the work is back with them; the new upload goes out automatically and the client hears about it.
  await page.reload();
  await page.getByRole('tab', { name: 'Proofs & approval' }).click();
  await page.getByLabel('Choose proof file').setInputFiles({ name: 'poster-v2.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('status').first()).toContainText('Version 2 was sent to the client');

  await clientPage.reload();
  await clientPage.getByRole('button', { name: /^Notifications/ }).click();
  await expect(clientPage.getByRole('dialog', { name: 'Notifications' }).getByText(/finished the changes.*version 2/).first()).toBeVisible();
  await clientPage.keyboard.press('Escape');
  await clientPage.getByRole('tab', { name: 'Proofs & approval' }).click();
  await clientPage.getByRole('button', { name: 'Approve' }).first().click();
  await clientPage.getByRole('button', { name: 'Confirm approval' }).click();
  await expect(clientPage.getByText('the design is approved')).toBeVisible();

  const lead = await token(request, ACCOUNTS.lead);
  const after = await (await request.get(`${API}/api/tickets`, { headers: { Authorization: `Bearer ${lead}` } })).json();
  expect(after.find((t: { id: number }) => t.id === ticket.id).status).toBe('Delivered');
});

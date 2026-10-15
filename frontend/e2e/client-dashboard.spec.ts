import { expect, test } from '@playwright/test';
import { ACCOUNTS, API, login, token } from './helpers';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');

test('the client dashboard puts the review first, with its deadline, and lists finished designs to download', async ({ page, request }) => {
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const lead = await token(request, ACCOUNTS.lead);
  const client = await token(request, ACCOUNTS.client);
  const types = await (await request.get(`${API}/api/design-types`, { headers: as(client) })).json();
  const make = async (title: string) => (await (await request.post(`${API}/api/tickets`, {
    headers: as(client), data: { title, brief: 'x', design_type_id: types[0].id, type_specific_fields: {} },
  })).json()) as { id: number };

  const review = await make('E2E dashboard poster');
  expect((await request.post(`${API}/api/tickets/${review.id}/proofs`, {
    headers: as(lead), multipart: { file: { name: 'poster.png', mimeType: 'image/png', buffer: PNG } },
  })).status()).toBe(201);
  const finished = await make('E2E dashboard banner');
  await request.post(`${API}/api/tickets/${finished.id}/proofs`, {
    headers: as(lead), multipart: { file: { name: 'banner.png', mimeType: 'image/png', buffer: PNG }, send_for_approval: 'false' },
  });
  await request.patch(`${API}/api/tickets/${finished.id}`, { headers: as(lead), data: { status: 'Delivered' } });

  await login(page, ACCOUNTS.client);
  const action = page.getByRole('region', { name: 'Needs your action' });
  const card = action.getByRole('article', { name: /E2E dashboard poster/ });
  await expect(card).toContainText('ready for your review');
  await expect(card).toContainText(/Closes in/);
  await card.getByRole('button', { name: 'Review & approve' }).click();
  await expect(card.getByRole('button', { name: 'Approve' })).toBeVisible();

  const gallery = page.getByRole('region', { name: 'Finished designs' });
  await expect(gallery.getByRole('button', { name: 'Download E2E dashboard banner' })).toBeVisible();
  await expect(page.getByText('Write a comment')).toHaveCount(0);   // no comment box for clients any more
});

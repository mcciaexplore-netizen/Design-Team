import { expect, test } from '@playwright/test';
import { ACCOUNTS, API, login, token } from './helpers';

test('a client types a comment in the portal, posts it and it appears', async ({ page, request }) => {
  const client = await token(request, ACCOUNTS.client);
  const types = await (await request.get(`${API}/api/design-types`, { headers: { Authorization: `Bearer ${client}` } })).json();
  const created = await request.post(`${API}/api/tickets`, {
    headers: { Authorization: `Bearer ${client}` },
    data: { title: 'E2E comment ticket', brief: 'Comment test', design_type_id: types[0].id, type_specific_fields: {} },
  });
  expect(created.status()).toBe(201);

  await login(page, ACCOUNTS.client);
  await page.getByText('E2E comment ticket').first().click();

  const box = page.getByLabel('Add a comment');
  const post = page.getByRole('button', { name: 'Post' });
  await post.click();                                      // nothing typed yet: it explains instead of doing nothing
  await expect(page.getByRole('alert')).toContainText('Write a comment first');
  await expect(box).toBeFocused();
  await box.fill('Please use the new logo');
  await post.click();

  await expect(page.getByText('Please use the new logo').first()).toBeVisible();
  await expect(box).toHaveValue('');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

// Same situation as a real portal ticket: two proof versions, a review waiting on the client, a laptop-sized window.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');

test('posting a comment works on a ticket that is out for review', async ({ page, request }) => {
  await page.setViewportSize({ width: 1447, height: 930 });
  const client = await token(request, ACCOUNTS.client);
  const designer = await token(request, ACCOUNTS.designer);
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const types = await (await request.get(`${API}/api/design-types`, { headers: as(client) })).json();
  const ticket = await (await request.post(`${API}/api/tickets`, {
    headers: as(client), data: { title: 'E2E review comment ticket', brief: 'Review test', design_type_id: types[0].id, type_specific_fields: {} },
  })).json();
  let last = 0;
  for (const name of ['v1.png', 'v2.png']) {
    const proof = await request.post(`${API}/api/tickets/${ticket.id}/proofs`, { headers: as(designer), multipart: { file: { name, mimeType: 'image/png', buffer: PNG } } });
    last = (await proof.json()).id;
  }
  await request.post(`${API}/api/tickets/${ticket.id}/approval-requests`, { headers: as(designer), data: { proof_version_id: last } });
  await request.patch(`${API}/api/tickets/${ticket.id}`, { headers: as(await token(request, ACCOUNTS.lead)), data: { status: 'Waiting on Requester' } });

  await login(page, ACCOUNTS.client);
  await page.getByText('E2E review comment ticket').first().click();
  const box = page.getByLabel('Add a comment');
  await box.scrollIntoViewIfNeeded();
  await box.fill('Comment on a ticket in review');
  await page.getByRole('button', { name: 'Post' }).click();       // fails loudly if anything covers the button
  await expect(page.getByText('Comment on a ticket in review').first()).toBeVisible();
  await expect(box).toHaveValue('');
});

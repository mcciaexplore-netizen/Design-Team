import { expect, test } from '@playwright/test';
import { ACCOUNTS, API, token } from './helpers';

// A 1x1 PNG, enough for a proof file.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');

test('a client approves a proof through the review link without signing in, and the ticket is delivered', async ({ page, request }) => {
  const client = await token(request, ACCOUNTS.client);
  const designer = await token(request, ACCOUNTS.designer);
  const lead = await token(request, ACCOUNTS.lead);
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });

  const types = await (await request.get(`${API}/api/design-types`, { headers: as(client) })).json();
  const created = await request.post(`${API}/api/tickets`, {
    headers: as(client),
    data: { title: 'E2E approval poster', brief: 'Please design a poster', design_type_id: types[0].id, type_specific_fields: {} },
  });
  expect(created.status()).toBe(201);
  const ticket = await created.json();

  const proof = await request.post(`${API}/api/tickets/${ticket.id}/proofs`, {
    headers: as(designer), multipart: { file: { name: 'proof.png', mimeType: 'image/png', buffer: PNG } },
  });
  expect(proof.status()).toBe(201);
  const approval = await request.post(`${API}/api/tickets/${ticket.id}/approval-requests`, {
    headers: as(designer), data: { proof_version_id: (await proof.json()).id },
  });
  expect(approval.status()).toBe(201);
  const reviewUrl = (await approval.json()).review_url as string;

  await page.goto(reviewUrl);
  await expect(page.getByRole('heading', { name: 'E2E approval poster' })).toBeVisible();
  await page.getByRole('button', { name: 'Approve this design' }).click();
  await expect(page.getByRole('alert')).toContainText('name');          // a name is required first
  await page.getByLabel(/your name/i).fill('Rhea Client');
  await page.getByRole('button', { name: 'Approve this design' }).click();
  await page.getByRole('button', { name: 'Yes, approve' }).click();
  await expect(page.getByRole('heading', { name: /approved/i })).toBeVisible();

  const after = await (await request.get(`${API}/api/tickets`, { headers: as(lead) })).json();
  const t = after.find((x: { id: number }) => x.id === ticket.id);
  expect(t.status).toBe('Delivered');

  // The link can only be used once.
  await page.reload();
  await expect(page.getByRole('heading', { name: /Approved/ })).toBeVisible();
});

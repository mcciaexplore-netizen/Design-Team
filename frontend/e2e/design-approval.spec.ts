import { expect, test } from '@playwright/test';
import { ACCOUNTS, API, login, token } from './helpers';

// Clients never sign in: the whole review conversation (sent for approval, changes requested, redo, approved)
// now happens through the one-time public review link in the User app (see also approval.spec.ts).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');

test('uploading a proof sends it for approval automatically; a change request opens V2, and a redo is approved from the new link', async ({ page, request }) => {
  const lead = await token(request, ACCOUNTS.lead);
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const types = await (await request.get(`${API}/api/design-types`, { headers: as(lead) })).json();
  const ticket = await (await request.post(`${API}/api/tickets`, {
    headers: as(lead), data: { title: 'E2E chained approval', brief: 'Poster', design_type_id: types[0].id, type_specific_fields: {} },
  })).json();

  // Designer: upload only. The checkbox defaults to on, so it is sent for approval in the same step.
  await login(page, ACCOUNTS.designer);
  await page.goto(`/tickets/${ticket.id}`);
  await page.getByRole('tab', { name: 'Proofs & approval' }).click();
  await expect(page.getByLabel('Send to the client for approval when uploaded')).toBeChecked();
  await page.getByLabel('Choose proof file').setInputFiles({ name: 'poster-v1.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('status').first()).toContainText('was sent for approval');
  const v1ReviewUrl = await page.getByLabel('Review link').inputValue();

  // The client (no account) opens the link and asks for a change. Reuse this same page as the browsing client.
  await page.goto(v1ReviewUrl);
  await expect(page.getByRole('heading', { name: 'E2E chained approval' })).toBeVisible();
  await page.getByRole('button', { name: 'Request changes' }).click();
  await page.getByLabel('Your name').fill('Rhea Client');
  await page.getByLabel('What would you like changed?').fill('Please make the headline bigger');
  await page.getByRole('button', { name: 'Send change request' }).click();
  await expect(page.getByText(/sent your feedback/i)).toBeVisible();

  const after = await (await request.get(`${API}/api/tickets`, { headers: as(lead) })).json();
  const v1 = after.find((t: { id: number }) => t.id === ticket.id);
  const v2 = after.find((t: { parent_id: number }) => t.parent_id === ticket.id);
  expect(v1.status).toBe('Revision Requested');
  expect(v2).toBeTruthy();

  // Designer redoes it on V2; the upload goes out for approval again, with a fresh review link.
  await page.goto(`/tickets/${v2.id}`);
  await page.getByRole('tab', { name: 'Proofs & approval' }).click();
  await page.getByLabel('Choose proof file').setInputFiles({ name: 'poster-v2.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('status').first()).toContainText('was sent for approval');
  const v2ReviewUrl = await page.getByLabel('Review link').inputValue();

  // The client approves this one.
  await page.goto(v2ReviewUrl);
  await expect(page.getByRole('heading', { name: 'E2E chained approval' })).toBeVisible();
  await page.getByRole('button', { name: 'Approve this design' }).click();
  await page.getByLabel('Your name').fill('Rhea Client');
  await page.getByRole('button', { name: 'Approve this design' }).click();
  await page.getByRole('button', { name: 'Yes, approve' }).click();
  await expect(page.getByRole('heading', { name: 'Approved' })).toBeVisible();

  const final = await (await request.get(`${API}/api/tickets`, { headers: as(lead) })).json();
  expect(final.find((t: { id: number }) => t.id === v2.id).status).toBe('Delivered');
  expect(final.find((t: { id: number }) => t.id === v1.id).status).toBe('Revision Requested');   // V1 stays closed out; V2 carried the work on
});

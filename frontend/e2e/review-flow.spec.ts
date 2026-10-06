import { expect, test } from '@playwright/test';
import { ACCOUNTS, API, login, token } from './helpers';

// A solid blue 240x160 image: big enough to click a spot on.
const DESIGN = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAPAAAACgCAIAAAC9uXYyAAABRElEQVR42u3SQQ0AAAjEsDODMuRjAhV8SJMqWJbqgTciAYYGQ4OhwdAYGgwNhgZDg6ExNBgaDA2GBkNjaDA0GBoMDYbG0GBoMDQYGgyNocHQYGgwNBgaQ4OhwdBgaDA0hgZDg6HB0BgaDA2GBkODoTE0GBoMDYYGQ2NoMDQYGgwNhsbQYGgwNBgaDI2hwdBgaDA0GBpDg6HB0GBoMDSGBkODocHQYGgMDYYGQ4OhMTQYGgwNhgZDY2gwNBgaDA2GxtBgaDA0GBoMjaHB0GBoMDQYGkODocHQYGgwNIYGQ4OhwdBgaAwNhgZDg6ExtAoYGgwNhgZDY2gwNBgaDA2GxtBgaDA0GBoMjaHB0GBoMDQYGkODocHQYGgwNIYGQ4OhwdBgaAwNhgZDg6HB0BgaDA2GBkNjaDA0GBoMDYbG0GBoMDTcWN4MbrjO5UM8AAAAAElFTkSuQmCC',
  'base64',
);

test('mark a spot, ask for changes, see the checklist on the redo, then approve from the notification bell', async ({ page, browser, request }) => {
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const client = await token(request, ACCOUNTS.client);
  const designer = await token(request, ACCOUNTS.designer);
  const types = await (await request.get(`${API}/api/design-types`, { headers: as(client) })).json();
  const ticket = await (await request.post(`${API}/api/tickets`, {
    headers: as(client), data: { title: 'E2E markup ticket', brief: 'Poster', design_type_id: types[0].id, type_specific_fields: {} },
  })).json();
  const upload = (name: string) => request.post(`${API}/api/tickets/${ticket.id}/proofs`, {
    headers: as(designer), multipart: { file: { name, mimeType: 'image/png', buffer: DESIGN } },
  });
  expect((await upload('v1.png')).status()).toBe(201);

  // Client: mark a spot on the design, then ask for changes without writing a note.
  await login(page, ACCOUNTS.client);
  await page.goto(`/tickets/${ticket.id}`);
  await page.getByRole('tab', { name: 'Proofs & approval' }).click();
  await expect(page.getByText('Your review is needed')).toBeVisible();
  await page.getByRole('button', { name: /Click to mark a spot/ }).click({ position: { x: 90, y: 50 } });
  await page.getByLabel(/What should change at spot 1/).fill('Make the logo bigger');
  await page.getByRole('button', { name: 'Save this spot' }).click();
  await expect(page.getByRole('list', { name: 'Marked spots' }).getByText('Make the logo bigger')).toBeVisible();

  await page.getByRole('button', { name: 'Request changes' }).first().click();
  await expect(page.getByText(/1 marked spot will be sent/)).toBeVisible();
  await page.getByRole('button', { name: 'Send feedback' }).click();                  // no written note needed
  await expect(page.getByText('your feedback was sent')).toBeVisible();
  // Asking for changes opened V2 as a new ticket (the link to it is shown right here).
  const v2Link = page.getByRole('link', { name: /-V2$/ });
  await expect(v2Link).toBeVisible();
  const v2Id = Number((await v2Link.getAttribute('href'))!.split('/').pop());

  // The conversation shows it all in one place.
  await page.getByRole('tab', { name: 'Overview & activity' }).click();
  const convo = page.getByRole('region', { name: 'Comments' });
  await expect(convo.getByText('marked a spot')).toBeVisible();
  await expect(convo.getByText(/asked for changes on version 1/)).toBeVisible();
  await expect(convo.getByText('Please see the 1 marked spot on the design.')).toBeVisible();

  // The designer redoes it on V2 and it goes out automatically.
  const redo = await request.post(`${API}/api/tickets/${v2Id}/proofs`, {
    headers: as(designer), multipart: { file: { name: 'v2.png', mimeType: 'image/png', buffer: DESIGN } },
  });
  expect(redo.status()).toBe(201);

  // Client: V2 shows the earlier feedback as a checklist and the comparison opens by itself.
  await page.goto(`/tickets/${v2Id}`);
  await page.getByRole('tab', { name: 'Proofs & approval' }).click();
  await expect(page.getByRole('heading', { name: /^Changes requested on DF-/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Hide comparison/ })).toBeVisible();
  await page.getByRole('checkbox', { name: /Make the logo bigger/ }).check();
  await page.reload();
  await page.getByRole('tab', { name: 'Proofs & approval' }).click();
  await expect(page.getByRole('checkbox', { name: /Make the logo bigger/ })).toBeChecked();   // ticks are remembered

  // Approve straight from the bell.
  await page.getByRole('button', { name: /^Notifications/ }).click();
  const bell = page.getByRole('dialog', { name: 'Notifications' });
  await expect(bell.getByText(/sent a design for your review.*-V2/).first()).toBeVisible();
  await bell.getByRole('button', { name: 'Approve design' }).first().click();
  await expect(bell.getByText('Approved. Thank you!')).toBeVisible();

  const lead = await token(request, ACCOUNTS.lead);
  const after = await (await request.get(`${API}/api/tickets`, { headers: as(lead) })).json();
  expect(after.find((t: { id: number }) => t.id === v2Id).status).toBe('Delivered');
  expect(after.find((t: { id: number }) => t.id === ticket.id).status).toBe('Revision Requested');

  // ...and nobody can approve it a second time.
  const again = await browser.newContext();
  const other = await again.newPage();
  await login(other, ACCOUNTS.client);
  await other.getByRole('button', { name: /^Notifications/ }).click();
  await other.getByRole('dialog', { name: 'Notifications' }).getByRole('button', { name: 'Approve design' }).first().click();
  await expect(other.getByText('Nothing is waiting for approval')).toBeVisible();
});

test('asking for changes opens V2, then V3, each as its own ticket, and the old version is closed', async ({ page, request }) => {
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const client = await token(request, ACCOUNTS.client);
  const lead = await token(request, ACCOUNTS.lead);
  const types = await (await request.get(`${API}/api/design-types`, { headers: as(client) })).json();
  const v1 = await (await request.post(`${API}/api/tickets`, {
    headers: as(client), data: { title: 'E2E versions', brief: 'Poster', design_type_id: types[0].id, type_specific_fields: {} },
  })).json();
  const deliver = (id: number) => request.patch(`${API}/api/tickets/${id}`, { headers: as(lead), data: { status: 'Delivered' } });
  const change = async (id: number, reason: string) => (await (await request.post(`${API}/api/tickets/${id}/revisions`, { headers: as(client), data: { reason_for_change: reason } })).json());

  await deliver(v1.id);
  const v2 = await change(v1.id, 'Round 1');                       // V1 -> V2
  expect(v2.ticket_number).toBe(`${v1.ticket_number}-V2`);
  await deliver(v2.id);
  const v3 = await change(v2.id, 'Round 2');                       // V2 -> V3
  expect(v3.ticket_number).toBe(`${v1.ticket_number}-V3`);
  await deliver(v3.id);

  // Round 3, from the button on the ticket page.
  await login(page, ACCOUNTS.client);
  await page.goto(`/tickets/${v3.id}`);
  await page.getByRole('button', { name: /^Request changes/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Request changes' });
  await expect(dialog.getByRole('heading', { name: 'Request changes (V4)' })).toBeVisible();   // it says which version it opens
  await dialog.getByLabel('Details').fill('Third round: swap the photo');
  await dialog.getByRole('button', { name: 'Submit revision' }).click();
  await expect(page).not.toHaveURL(new RegExp(`/tickets/${v3.id}$`));   // it moves on to the new version
  await expect(page).toHaveURL(/\/tickets\/\d+$/);
  const v4Id = Number(page.url().split('/').pop());
  expect(v4Id).not.toBe(v3.id);

  const all = (await (await request.get(`${API}/api/tickets`, { headers: as(lead) })).json()).filter((t: { title: string }) => t.title === 'E2E versions');
  expect(all.map((t: { ticket_number: string }) => t.ticket_number).sort()).toEqual(
    [v1.ticket_number, `${v1.ticket_number}-V2`, `${v1.ticket_number}-V3`, `${v1.ticket_number}-V4`]);
  const v4 = all.find((t: { id: number }) => t.id === v4Id);
  expect(v4.parent_id).toBe(v3.id);
  expect(v4.tags).toContain('Extra revision');                      // past the two free revisions: flagged, still just a version
  for (const old of [v1.id, v2.id, v3.id]) expect(all.find((t: { id: number }) => t.id === old).status).toBe('Revision Requested');
});

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

  // The conversation shows it all in one place.
  await page.getByRole('tab', { name: 'Overview & activity' }).click();
  const convo = page.getByRole('region', { name: 'Comments' });
  await expect(convo.getByText('marked a spot')).toBeVisible();
  await expect(convo.getByText(/asked for changes on version 1/)).toBeVisible();
  await expect(convo.getByText('Please see the 1 marked spot on the design.')).toBeVisible();

  // Designer redoes it; the new version goes out automatically.
  expect((await upload('v2.png')).status()).toBe(201);

  // Client: the checklist of earlier feedback is there and the comparison opens by itself.
  await page.reload();
  await page.getByRole('tab', { name: 'Proofs & approval' }).click();
  await expect(page.getByRole('heading', { name: 'Changes requested on version 1' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Hide comparison/ })).toBeVisible();
  const item = page.getByRole('checkbox', { name: /Make the logo bigger/ });
  await item.check();
  await page.reload();
  await page.getByRole('tab', { name: 'Proofs & approval' }).click();
  await expect(page.getByRole('checkbox', { name: /Make the logo bigger/ })).toBeChecked();   // ticks are remembered

  // Approve straight from the bell.
  await page.getByRole('button', { name: /^Notifications/ }).click();
  const bell = page.getByRole('dialog', { name: 'Notifications' });
  await expect(bell.getByText(/finished the changes/).first()).toBeVisible();
  await bell.getByRole('button', { name: 'Approve design' }).first().click();
  await expect(bell.getByText('Approved. Thank you!')).toBeVisible();

  const lead = await token(request, ACCOUNTS.lead);
  const after = await (await request.get(`${API}/api/tickets`, { headers: as(lead) })).json();
  expect(after.find((t: { id: number }) => t.id === ticket.id).status).toBe('Delivered');

  // ...and nobody else can approve it a second time.
  const again = await browser.newContext();
  const other = await again.newPage();
  await login(other, ACCOUNTS.client);
  await other.getByRole('button', { name: /^Notifications/ }).click();
  await other.getByRole('dialog', { name: 'Notifications' }).getByRole('button', { name: 'Approve design' }).first().click();
  await expect(other.getByText('Nothing is waiting for approval')).toBeVisible();
});

import { expect, test } from '@playwright/test';
import { ACCOUNTS, API, login, token } from './helpers';

test('two accounts with the same name get separate columns, and a ticket sits under the right one', async ({ page, request }) => {
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const lead = await token(request, ACCOUNTS.lead);
  const client = await token(request, ACCOUNTS.client);

  // A second designer who happens to share a name with Alice Fernandez.
  const twin = await request.post(`${API}/api/admin/users`, { headers: as(lead), data: { full_name: 'Alice Fernandez', email: 'alice.twin@mccia.in', role: 'Designer' } });
  expect(twin.status()).toBe(201);
  const twinId = (await twin.json()).user.id as number;

  const types = await (await request.get(`${API}/api/design-types`, { headers: as(client) })).json();
  const made = await (await request.post(`${API}/api/tickets`, { headers: as(client), data: { title: 'E2E twin ticket', brief: 'x', design_type_id: types[0].id, type_specific_fields: {} } })).json();
  const assigned = await request.patch(`${API}/api/tickets/${made.id}`, { headers: as(lead), data: { assignee_id: twinId } });
  expect(assigned.ok()).toBeTruthy();

  await login(page, ACCOUNTS.lead);
  await page.getByRole('group', { name: 'Group board by' }).getByRole('button', { name: 'By person' }).click();

  const original = page.getByRole('heading', { name: 'Alice Fernandez (alice@mccia.in)', exact: true });
  const second = page.getByRole('heading', { name: 'Alice Fernandez (alice.twin@mccia.in)', exact: true });
  await expect(original).toBeVisible();
  await expect(second).toBeVisible();                                    // two columns, not one merged column

  const column = (label: ReturnType<typeof page.getByRole>) => label.locator('xpath=ancestor::div[contains(@class,"glass-card")][1]');
  await expect(column(second)).toContainText('E2E twin ticket');         // under the account it is assigned to...
  await expect(column(original)).not.toContainText('E2E twin ticket');   // ...and not under the same-named one
});

test('clicking a card on the board opens the full ticket page', async ({ page, request }) => {
  const client = await token(request, ACCOUNTS.client);
  const types = await (await request.get(`${API}/api/design-types`, { headers: { Authorization: `Bearer ${client}` } })).json();
  const made = await (await request.post(`${API}/api/tickets`, {
    headers: { Authorization: `Bearer ${client}` }, data: { title: 'E2E full page ticket', brief: 'x', design_type_id: types[0].id, type_specific_fields: {} },
  })).json();

  await login(page, ACCOUNTS.lead);
  await page.getByText('E2E full page ticket').first().click();
  await expect(page).toHaveURL(new RegExp(`/tickets/${made.id}$`));
  await expect(page.getByRole('heading', { name: 'E2E full page ticket' })).toBeVisible();
  await expect(page.getByText('Write a comment')).toHaveCount(0);   // no conversation box on the ticket page
});

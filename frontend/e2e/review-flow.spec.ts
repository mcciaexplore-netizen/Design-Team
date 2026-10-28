import { expect, test } from '@playwright/test';
import { ACCOUNTS, API, login, token } from './helpers';

// Clients never sign in, so "ask for changes" that isn't tied to a public review decision (e.g. the client phoned
// or emailed instead) is now a staff action: the same /revisions endpoint and dialog, just reached by staff.
// The pin/mark-a-spot review and the notification-bell approval were client-portal only and have no replacement;
// a client's approve/request-changes now happens solely through the public review link (see design-approval.spec.ts).

test('asking for changes opens V2, then V3, each as its own ticket, and the old version is closed', async ({ page, request }) => {
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const lead = await token(request, ACCOUNTS.lead);
  const types = await (await request.get(`${API}/api/design-types`, { headers: as(lead) })).json();
  const v1 = await (await request.post(`${API}/api/tickets`, {
    headers: as(lead), data: { title: 'E2E versions', brief: 'Poster', design_type_id: types[0].id, type_specific_fields: {} },
  })).json();
  const deliver = (id: number) => request.patch(`${API}/api/tickets/${id}`, { headers: as(lead), data: { status: 'Delivered' } });
  const change = async (id: number, reason: string) => (await (await request.post(`${API}/api/tickets/${id}/revisions`, { headers: as(lead), data: { reason_for_change: reason } })).json());

  await deliver(v1.id);
  const v2 = await change(v1.id, 'Round 1');                       // V1 -> V2
  expect(v2.ticket_number).toBe(`${v1.ticket_number}-V2`);
  await deliver(v2.id);
  const v3 = await change(v2.id, 'Round 2');                       // V2 -> V3
  expect(v3.ticket_number).toBe(`${v1.ticket_number}-V3`);
  await deliver(v3.id);

  // Round 3, from the button on the ticket page.
  await login(page, ACCOUNTS.lead);
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

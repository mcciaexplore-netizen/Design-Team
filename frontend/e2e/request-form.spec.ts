import { expect, test, type Page } from '@playwright/test';
import { ACCOUNTS, API, USER_BASE, dateInDays, token } from './helpers';

// The public request form, tracking page and board all live in the User app now (no sign-in, no account).
// "New Request" from a signed-in account, and "Request again" on a finished ticket, were client-portal-only
// features with no replacement; staff create tickets instead via the "New Ticket" button in the Admin app.

// A tiny valid PNG, so image thumbnails and the server's file check both accept it.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const png = (name: string) => ({ name, mimeType: 'image/png', buffer: PNG });

const FLYER = 'Flyer (Email / Print)';
const box = (root: Pick<Page, 'getByRole'>, name: string) => root.getByRole('checkbox', { name, exact: true });

/** Tick exactly this one design, unticking any others. */
async function only(page: Page, name: string) {
  const group = page.getByRole('group', { name: 'Design requirement *' });
  for (const ticked of await group.getByRole('checkbox', { checked: true }).all()) await ticked.uncheck();
  await box(page, name).check();
}

test('anyone can submit the public request form, get a ticket and follow it on the tracking page', async ({ page, request }) => {
  await page.goto(`${USER_BASE}/request`);
  await expect(page.getByRole('heading', { name: /Request for Creative/ })).toBeVisible();

  await page.getByLabel('Name *', { exact: true }).fill('Meera Joshi');
  await page.getByLabel('Email *').fill('meera.e2e@example.com');
  await page.getByLabel('Event name *').fill('E2E Open Day');
  await page.getByLabel('Event / Workshop date *').fill(dateInDays(30));
  await page.getByLabel('Expected delivery date *').fill(dateInDays(1));

  // "Other" asks for details; Flyer asks its own questions instead.
  await box(page, 'Other').check();
  await expect(page.getByLabel('Please specify the design requirement *')).toBeVisible();
  await box(page, 'Other').uncheck();
  await box(page, FLYER).check();
  await expect(page.getByLabel('Please specify the design requirement *')).toHaveCount(0);
  await page.getByLabel('Size *', { exact: true }).selectOption('A5');
  await page.getByLabel('Where will it be shared? *').selectOption('Print');

  await page.getByLabel('No. of creatives required').fill('2');
  await page.getByLabel('Share content for the design creatives').fill('Use the blue brand theme.');
  await page.getByRole('button', { name: 'Add a link' }).click();
  await page.getByLabel('Reference link 1').fill('https://www.canva.com/design/e2e');
  await page.getByLabel(/Attach files/).setInputFiles([png('one.png'), png('two.png')]);
  await page.getByRole('button', { name: 'Submit request' }).click();

  await expect(page.getByRole('status')).toContainText('Request received');
  const number = (await page.getByRole('status').locator('strong').textContent())!.trim();
  expect(number).toMatch(/^DF-\d{4}$/);

  // The tracking link works with no sign-in.
  await page.getByRole('link', { name: 'Track this request' }).click();
  await expect(page.getByRole('heading', { name: /E2E Open Day/ })).toBeVisible();
  await expect(page.getByText(number)).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Request received' })).toBeVisible();
  await expect(page.getByText('meera.e2e@example.com')).toHaveCount(0);

  // Urgent (due tomorrow), with both files, the per-type answers and the link stored -- and waiting for a
  // Design Lead to accept it before it is assigned and enters the workflow.
  const lead = await token(request, ACCOUNTS.lead);
  const headers = { Authorization: `Bearer ${lead}` };
  const tickets = await (await request.get(`${API}/api/tickets`, { headers })).json();
  const pending = tickets.find((x: { ticket_number: string }) => x.ticket_number === number);
  expect(pending.priority).toBe('Urgent');
  expect(pending.status).toBe('Pending Review');
  expect(pending.assignee).toBeNull();

  // Once accepted, it is auto-assigned.
  const t = await (await request.post(`${API}/api/tickets/${pending.id}/accept`, { headers })).json();
  expect(t.status).toBe('Assigned');
  expect(t.assignee).not.toBeNull();
  expect(t.type_specific_fields.details).toEqual({ size: 'A5', channel: 'Print' });
  expect(t.type_specific_fields.reference_links).toEqual(['https://www.canva.com/design/e2e']);
  expect(t.brief).toContain('Size: A5');
  const atts = await (await request.get(`${API}/api/tickets/${t.id}/attachments`, { headers })).json();
  expect(atts.map((a: { file_name: string }) => a.file_name).sort()).toEqual(['one.png', 'two.png']);

  // The next visit remembers who submitted, and the draft is gone.
  await page.goto(`${USER_BASE}/request`);
  await expect(page.getByLabel('Name *', { exact: true })).toHaveValue('Meera Joshi');
  await expect(page.getByLabel('Email *')).toHaveValue('meera.e2e@example.com');
  await expect(page.getByText('Draft restored')).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByLabel('Name *', { exact: true })).toHaveValue('');
  await page.reload();
  await expect(page.getByLabel('Name *', { exact: true })).toHaveValue('');
});

test('mistakes are shown beside each field, with a summary whose links jump to the field', async ({ page }) => {
  await page.goto(`${USER_BASE}/request`);
  await page.getByRole('button', { name: 'Submit request' }).click();

  const summary = page.getByRole('alert');
  await expect(summary).toContainText('Please fix 6 things');
  await expect(page.getByLabel('Name *', { exact: true })).toBeFocused();
  await expect(page.getByLabel('Name *', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#rf-name-error')).toHaveText('Enter your name');
  await expect(page.getByLabel('Name *', { exact: true })).toHaveAttribute('aria-describedby', 'rf-name-error');

  await summary.getByRole('link', { name: 'Choose the event or workshop date' }).click();
  await expect(page.getByLabel('Event / Workshop date *')).toBeFocused();
  await summary.getByRole('link', { name: 'Choose at least one design requirement' }).click();
  await expect(box(page, FLYER)).toBeFocused();

  // Fixing a field clears its message; a malformed email and a non-https link are caught before anything is sent.
  await page.getByLabel('Name *', { exact: true }).fill('Asha');
  await expect(page.locator('#rf-name-error')).toHaveCount(0);
  await page.getByLabel('Email *').fill('not-an-email');
  await page.getByLabel('Event name *').fill('Validation Day');
  await page.getByLabel('Event / Workshop date *').fill(dateInDays(30));
  await box(page, FLYER).check();
  await page.getByLabel('Expected delivery date *').fill(dateInDays(10));
  await page.getByRole('button', { name: 'Add a link' }).click();
  await page.getByLabel('Reference link 1').fill('http://insecure.example.com');
  await page.getByRole('button', { name: 'Submit request' }).click();
  await expect(summary).toContainText('Please fix 4 things');
  await expect(page.locator('#rf-email-error')).toContainText('valid email');
  await expect(page.locator('#rf-q-Flyer--Email---Print--size-error')).toContainText('Choose an option');
  await expect(page.locator('#rf-link-0-error')).toContainText('https://');
  await expect(page.locator('#rf-link-0')).toHaveAttribute('aria-invalid', 'true');
});

test('each design type asks its own questions', async ({ page }) => {
  await page.goto(`${USER_BASE}/request`);
  await only(page, FLYER);
  await expect(page.getByLabel('Size *', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Where will it be shared? *')).toBeVisible();
  await expect(page.getByLabel('Language')).toBeVisible();   // optional on every type: no asterisk

  // WhatsApp, Instagram and LinkedIn are separate choices, each with its own optional questions.
  await only(page, 'WhatsApp creative');
  await expect(page.getByLabel('Where will it be shared? *')).toHaveCount(0);
  await expect(page.getByLabel('Message or call-to-action to show on it')).toBeVisible();

  await only(page, 'Instagram post');
  await expect(page.getByLabel('Number of slides (for a carousel)')).toBeVisible();
  await expect(page.getByLabel('Account or people to tag')).toBeVisible();
  await expect(page.getByLabel('Message or call-to-action to show on it')).toHaveCount(0);

  await only(page, 'LinkedIn post');
  await expect(page.getByLabel('Number of slides (for a carousel)')).toBeVisible();
  await expect(page.getByLabel('Page or people to tag')).toBeVisible();

  await only(page, 'Twitter / X post');
  await expect(page.getByLabel('Language')).toBeVisible();   // its only question
  await expect(page.getByLabel('Number of slides (for a carousel)')).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: /Insta, LinkedIn/ })).toHaveCount(0);   // the old bundled choice is gone

  await only(page, 'Flex/Banner/Standee');
  await expect(page.getByLabel('Size (width x height) *')).toBeVisible();
  await expect(page.getByLabel('Print or digital? *')).toBeVisible();
  await expect(page.getByLabel('Quantity')).toBeVisible();

  await only(page, 'Digital Backdrop & Slides');
  await expect(page.getByLabel('Number of slides *')).toBeVisible();
  await expect(page.getByLabel('Aspect ratio *')).toBeVisible();

  await only(page, 'Book');
  await expect(page.getByLabel('Number of pages *')).toBeVisible();
  await expect(page.getByLabel('Is the content ready? *')).toBeVisible();

  await only(page, '4 pages Brochure');
  await expect(page.getByLabel('Copy *', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Language')).toBeVisible();

  await only(page, 'Photo/Video/Reel');
  await expect(page.getByLabel('Duration (if video or reel)')).toBeVisible();
  await expect(page.getByLabel('Shoot date and location')).toBeVisible();

  await only(page, 'Other');
  await expect(page.getByRole('group', { name: 'Details for Other' }).getByLabel('Language')).toBeVisible();   // its only question
});

test('several files can be added, previewed and removed, and bad files are rejected one by one', async ({ page }) => {
  await page.goto(`${USER_BASE}/request`);
  const picker = page.getByLabel(/Attach files/);
  await picker.setInputFiles([png('a.png'), png('b.png'), { name: 'virus.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') }]);

  const list = page.getByRole('list', { name: 'Attached files' });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list.locator('img')).toHaveCount(2);                         // image thumbnails
  await expect(page.getByText('virus.exe: .exe files are not allowed')).toBeVisible();

  await picker.setInputFiles([png('c.png'), png('d.png'), png('e.png'), png('f.png')]);
  await expect(list.getByRole('listitem')).toHaveCount(5);
  await expect(page.getByText('f.png: only 5 files can be attached')).toBeVisible();

  await page.getByRole('button', { name: 'Remove a.png' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(4);
  await expect(list.getByText('a.png')).toHaveCount(0);

  // Dropping files works like the picker.
  const data = await page.evaluateHandle(() => { const dt = new DataTransfer(); dt.items.add(new File(['x'], 'dropped.txt', { type: 'text/plain' })); return dt; });
  await page.getByText('Drag files here or').dispatchEvent('drop', { dataTransfer: data });
  await expect(list.getByText('dropped.txt')).toBeVisible();
});

test('a date earlier than the usual turnaround shows a warning', async ({ page }) => {
  await page.goto(`${USER_BASE}/request`);
  await box(page, 'Book').check();
  await expect(page.getByText('earlier than the standard turnaround')).toHaveCount(0);

  const tomorrow = dateInDays(1);
  await page.getByLabel('Expected delivery date *').fill(tomorrow);
  await expect(page.getByText('earlier than the standard turnaround')).toBeVisible();

  await page.getByLabel('Expected delivery date *').fill(dateInDays(90));
  await expect(page.getByText('earlier than the standard turnaround')).toHaveCount(0);
});

test('a half-filled form is saved as a draft, restored on the next visit and can be discarded', async ({ page }) => {
  await page.goto(`${USER_BASE}/request`);
  await page.getByLabel('Event name *').fill('Draft Festival');
  await box(page, 'Flex/Banner/Standee').check();
  await page.getByLabel('Size (width x height) *').fill('8x4 ft');
  await page.getByRole('button', { name: 'Add a link' }).click();
  await page.getByLabel('Reference link 1').fill('https://www.figma.com/file/draft');
  await page.waitForFunction(() => localStorage.getItem('designdesk.requestDraft.public')?.includes('figma.com'));   // saved a moment after the last keystroke

  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: 'Draft restored' })).toBeVisible();
  await expect(page.getByLabel('Event name *')).toHaveValue('Draft Festival');
  await expect(box(page, 'Flex/Banner/Standee')).toBeChecked();
  await expect(page.getByLabel('Size (width x height) *')).toHaveValue('8x4 ft');
  await expect(page.getByLabel('Reference link 1')).toHaveValue('https://www.figma.com/file/draft');

  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByText('Draft restored')).toHaveCount(0);
  await expect(page.getByLabel('Event name *')).toHaveValue('');
  await page.reload();
  await expect(page.getByText('Draft restored')).toHaveCount(0);
  await expect(page.getByLabel('Event name *')).toHaveValue('');
});

test('an invalid tracking link says so', async ({ page }) => {
  await page.goto(`${USER_BASE}/track/DF-0001.notavalidsignature00000`);
  await expect(page.getByRole('alert')).toContainText('not valid');
});

test('ticking several designs makes one ticket covering all of them, each with its own questions', async ({ page, request }) => {
  await page.goto(`${USER_BASE}/request`);
  await page.getByLabel('Name *', { exact: true }).fill('Ravi Kulkarni');
  await page.getByLabel('Email *').fill('ravi.e2e@example.com');
  await page.getByLabel('Event name *').fill('E2E Expo');
  await page.getByLabel('Event / Workshop date *').fill(dateInDays(30));
  await page.getByLabel('Expected delivery date *').fill(dateInDays(10));
  await box(page, FLYER).check();
  await box(page, 'Instagram post').check();

  const flyer = page.getByRole('group', { name: `Details for ${FLYER}` });
  const insta = page.getByRole('group', { name: 'Details for Instagram post' });
  await flyer.getByLabel('Where will it be shared? *').selectOption('Email');
  await page.getByRole('button', { name: 'Submit request' }).click();
  await expect(page.getByRole('alert')).toContainText(`${FLYER}: Choose an option for “Size”`);   // each design's own required question

  await flyer.getByLabel('Size *', { exact: true }).selectOption('A4');
  await insta.getByLabel('Account or people to tag').fill('@mccia_pune');   // optional, but kept when given
  await page.getByRole('button', { name: 'Submit request' }).click();
  const done = page.getByRole('status').filter({ hasText: 'Request received' });
  await expect(done).toContainText('Your ticket number is');

  // Both designs land on a single ticket, with each one's own answers kept separately.
  const lead = await token(request, ACCOUNTS.lead);
  const tickets = await (await request.get(`${API}/api/tickets`, { headers: { Authorization: `Bearer ${lead}` } })).json();
  const t = tickets.find((x: { title: string }) => x.title.startsWith('E2E Expo'));
  expect(t.title).toContain('+1 more');
  expect(t.type_specific_fields.design_requirements).toEqual([FLYER, 'Instagram post']);
  expect(t.type_specific_fields.details[FLYER]).toMatchObject({ size: 'A4', channel: 'Email' });
  expect(t.type_specific_fields.details['Instagram post']).toMatchObject({ tag: '@mccia_pune' });
});

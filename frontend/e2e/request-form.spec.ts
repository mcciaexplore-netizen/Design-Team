import { expect, test, type Page } from '@playwright/test';
import { ACCOUNTS, API, dateInDays, login, token } from './helpers';

// A tiny valid PNG, so image thumbnails and the server's file check both accept it.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const png = (name: string) => ({ name, mimeType: 'image/png', buffer: PNG });

const FLYER = 'Flyer (Email/Whatsapp)';
const radio = (root: Pick<Page, 'getByRole'>, name: string) => root.getByRole('radio', { name, exact: true });

test('anyone can submit the public request form, get a ticket and follow it on the tracking page', async ({ page, request }) => {
  await page.goto('/request');
  await expect(page.getByRole('heading', { name: /Request for Creative/ })).toBeVisible();

  await page.getByLabel('Name *', { exact: true }).fill('Meera Joshi');
  await page.getByLabel('Email *').fill('meera.e2e@example.com');
  await page.getByLabel('Event name *').fill('E2E Open Day');
  await page.getByLabel('Event / Workshop date *').fill(dateInDays(30));
  await page.getByLabel('Expected delivery date *').fill(dateInDays(1));

  // "Other" asks for details; Flyer asks its own questions instead.
  await radio(page, 'Other').check();
  await expect(page.getByLabel('Please specify the design requirement *')).toBeVisible();
  await radio(page, FLYER).check();
  await expect(page.getByLabel('Please specify the design requirement *')).toHaveCount(0);
  await page.getByLabel('Size *', { exact: true }).selectOption('A5');
  await page.getByLabel('Where will it be shared? *').selectOption('WhatsApp');

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

  // Auto-assigned, Urgent (due tomorrow), with both files, the per-type answers and the link stored.
  const lead = await token(request, ACCOUNTS.lead);
  const headers = { Authorization: `Bearer ${lead}` };
  const tickets = await (await request.get(`${API}/api/tickets`, { headers })).json();
  const t = tickets.find((x: { ticket_number: string }) => x.ticket_number === number);
  expect(t.priority).toBe('Urgent');
  expect(t.status).toBe('Assigned');
  expect(t.assignee).not.toBeNull();
  expect(t.type_specific_fields.details).toEqual({ size: 'A5', channel: 'WhatsApp' });
  expect(t.type_specific_fields.reference_links).toEqual(['https://www.canva.com/design/e2e']);
  expect(t.brief).toContain('Size: A5');
  const atts = await (await request.get(`${API}/api/tickets/${t.id}/attachments`, { headers })).json();
  expect(atts.map((a: { file_name: string }) => a.file_name).sort()).toEqual(['one.png', 'two.png']);

  // The next visit remembers who submitted, and the draft is gone.
  await page.goto('/request');
  await expect(page.getByLabel('Name *', { exact: true })).toHaveValue('Meera Joshi');
  await expect(page.getByLabel('Email *')).toHaveValue('meera.e2e@example.com');
  await expect(page.getByText('Draft restored')).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByLabel('Name *', { exact: true })).toHaveValue('');
  await page.reload();
  await expect(page.getByLabel('Name *', { exact: true })).toHaveValue('');
});

test('mistakes are shown beside each field, with a summary whose links jump to the field', async ({ page }) => {
  await page.goto('/request');
  await page.getByRole('button', { name: 'Submit request' }).click();

  const summary = page.getByRole('alert');
  await expect(summary).toContainText('Please fix 6 things');
  await expect(page.getByLabel('Name *', { exact: true })).toBeFocused();
  await expect(page.getByLabel('Name *', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#rf-name-error')).toHaveText('Enter your name');
  await expect(page.getByLabel('Name *', { exact: true })).toHaveAttribute('aria-describedby', 'rf-name-error');

  await summary.getByRole('link', { name: 'Choose the event or workshop date' }).click();
  await expect(page.getByLabel('Event / Workshop date *')).toBeFocused();
  await summary.getByRole('link', { name: 'Choose a design requirement' }).click();
  await expect(radio(page, FLYER)).toBeFocused();

  // Fixing a field clears its message; a malformed email and a non-https link are caught before anything is sent.
  await page.getByLabel('Name *', { exact: true }).fill('Asha');
  await expect(page.locator('#rf-name-error')).toHaveCount(0);
  await page.getByLabel('Email *').fill('not-an-email');
  await page.getByLabel('Event name *').fill('Validation Day');
  await page.getByLabel('Event / Workshop date *').fill(dateInDays(30));
  await radio(page, FLYER).check();
  await page.getByLabel('Expected delivery date *').fill(dateInDays(10));
  await page.getByRole('button', { name: 'Add a link' }).click();
  await page.getByLabel('Reference link 1').fill('http://insecure.example.com');
  await page.getByRole('button', { name: 'Submit request' }).click();
  await expect(summary).toContainText('Please fix 4 things');
  await expect(page.locator('#rf-email-error')).toContainText('valid email');
  await expect(page.locator('#rf-q-size-error')).toContainText('Choose an option');
  await expect(page.locator('#rf-link-0-error')).toContainText('https://');
  await expect(page.locator('#rf-link-0')).toHaveAttribute('aria-invalid', 'true');
});

test('each design type asks its own questions', async ({ page }) => {
  await page.goto('/request');
  await radio(page, FLYER).check();
  await expect(page.getByLabel('Size *', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Where will it be shared? *')).toBeVisible();

  await radio(page, 'Social Media Post (Insta, LinkedIn, Twitter)').check();
  await expect(page.getByLabel('Where will it be shared? *')).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Instagram' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'LinkedIn' })).toBeVisible();

  await radio(page, 'Flex/Banner/Standee').check();
  await expect(page.getByLabel('Size (width x height) *')).toBeVisible();
  await expect(page.getByLabel('Print or digital? *')).toBeVisible();
  await expect(page.getByLabel('Quantity')).toBeVisible();

  await radio(page, 'Digital Backdrop & Slides').check();
  await expect(page.getByLabel('Number of slides *')).toBeVisible();
  await expect(page.getByLabel('Aspect ratio *')).toBeVisible();

  await radio(page, 'Directory').check();
  await expect(page.getByLabel('Number of pages *')).toBeVisible();
  await expect(page.getByLabel('Is the content ready? *')).toBeVisible();

  await radio(page, '4 pages Brochure').check();
  await expect(page.getByLabel('Copy *', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Language *')).toBeVisible();

  await radio(page, 'Photo/Video/Reel').check();
  await expect(page.getByLabel('Duration (if video or reel)')).toBeVisible();
  await expect(page.getByLabel('Shoot date and location')).toBeVisible();

  await radio(page, 'Other').check();
  await expect(page.getByRole('group', { name: /Details for/ })).toHaveCount(0);
});

test('several files can be added, previewed and removed, and bad files are rejected one by one', async ({ page }) => {
  await page.goto('/request');
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

test('the due date is shown before submitting, with a warning when it is earlier than usual', async ({ page }) => {
  await page.goto('/request');
  await expect(page.getByText('Standard turnaround')).toHaveCount(0);
  await radio(page, 'Directory').check();
  await expect(page.getByText(/Standard turnaround: ready by \w{3} \d{1,2} \w{3}/)).toBeVisible();
  await expect(page.getByText('earlier than usual')).toHaveCount(0);

  const tomorrow = dateInDays(1);
  await page.getByLabel('Expected delivery date *').fill(tomorrow);
  await expect(page.getByText(/earlier than usual\. This will be marked Urgent and may not be possible\./)).toBeVisible();

  await page.getByLabel('Expected delivery date *').fill(dateInDays(90));
  await expect(page.getByText('earlier than usual')).toHaveCount(0);
  await expect(page.getByText(/Standard turnaround/)).toBeVisible();
});

test('a half-filled form is saved as a draft, restored on the next visit and can be discarded', async ({ page }) => {
  await page.goto('/request');
  await page.getByLabel('Event name *').fill('Draft Festival');
  await radio(page, 'Flex/Banner/Standee').check();
  await page.getByLabel('Size (width x height) *').fill('8x4 ft');
  await page.getByRole('button', { name: 'Add a link' }).click();
  await page.getByLabel('Reference link 1').fill('https://www.figma.com/file/draft');
  await page.waitForFunction(() => localStorage.getItem('designdesk.requestDraft.public')?.includes('figma.com'));   // saved a moment after the last keystroke

  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: 'Draft restored' })).toBeVisible();
  await expect(page.getByLabel('Event name *')).toHaveValue('Draft Festival');
  await expect(radio(page, 'Flex/Banner/Standee')).toBeChecked();
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
  await page.goto('/track/DF-0001.notavalidsignature00000');
  await expect(page.getByRole('alert')).toContainText('not valid');
});

test('a client creates a request from the New Request dialog and the lead sees it assigned', async ({ page, browser }) => {
  await login(page, ACCOUNTS.client);
  await page.getByRole('button', { name: 'New Request' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Priority and the designer are set automatically')).toBeVisible();
  await expect(dialog.getByText(/Requesting as/)).toContainText('·');          // name · organisation
  await expect(dialog.getByLabel('Email *')).toHaveCount(0);                    // a signed-in client is never asked who they are

  // Half-fill and cancel: the draft comes back when the dialog is reopened.
  await dialog.getByLabel('Event name *').fill('Client Dialog Workshop');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'New Request' }).first().click();
  await expect(dialog.getByRole('status').filter({ hasText: 'Draft restored' })).toBeVisible();
  await expect(dialog.getByLabel('Event name *')).toHaveValue('Client Dialog Workshop');

  // Required questions are checked in the dialog too.
  await dialog.getByLabel('Event / Workshop date *').fill(dateInDays(20));
  await radio(dialog, '2 pages Brochure').check();
  await dialog.getByLabel('Expected delivery date *').fill(dateInDays(6));
  await dialog.getByRole('button', { name: 'Submit request' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Please fix 2 things');
  await dialog.getByLabel('Copy *', { exact: true }).selectOption('Needs writing');
  await dialog.getByLabel('Language *').fill('Marathi');
  await dialog.getByRole('button', { name: 'Submit request' }).click();

  await expect(dialog.getByRole('heading', { name: /created/ })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).last().click();
  await expect(page.getByText('Client Dialog Workshop').first()).toBeVisible();

  const leadPage = await (await browser.newContext()).newPage();
  await login(leadPage, ACCOUNTS.lead);
  await expect(leadPage.getByText('Client Dialog Workshop').first()).toBeVisible();

  // The draft was cleared by the successful submit.
  await page.getByRole('button', { name: 'New Request' }).first().click();
  await expect(dialog.getByText('Draft restored')).toHaveCount(0);
});

test('a finished request can be requested again from the portal and from the ticket page', async ({ page, request }) => {
  const client = await token(request, ACCOUNTS.client);
  const lead = await token(request, ACCOUNTS.lead);
  const created = await request.post(`${API}/api/requests`, {
    headers: { Authorization: `Bearer ${client}` },
    multipart: {
      event_name: 'Again Fest', event_date: dateInDays(40), design_requirement: 'Flex/Banner/Standee', delivery_date: dateInDays(30),
      num_creatives: '3', content: 'Keep the gold border.',
      details: JSON.stringify({ size: '6x3 ft', medium: 'Print', quantity: '2' }),
      reference_links: JSON.stringify(['https://www.figma.com/file/again']),
    },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  const done = await request.patch(`${API}/api/tickets/${id}`, { headers: { Authorization: `Bearer ${lead}` }, data: { status: 'Delivered' } });
  expect(done.ok()).toBeTruthy();

  await login(page, ACCOUNTS.client);
  const dialog = page.getByRole('dialog');
  const expectPrefilled = async () => {
    await expect(dialog.getByLabel('Event name *')).toHaveValue('Again Fest');
    await expect(radio(page, 'Flex/Banner/Standee')).toBeChecked();
    await expect(dialog.getByLabel('Size (width x height) *')).toHaveValue('6x3 ft');
    await expect(dialog.getByLabel('Print or digital? *')).toHaveValue('Print');
    await expect(dialog.getByLabel('Quantity')).toHaveValue('2');
    await expect(dialog.getByLabel('No. of creatives required')).toHaveValue('3');
    await expect(dialog.getByLabel('Share content for the design creatives')).toHaveValue('Keep the gold border.');
    await expect(dialog.getByLabel('Reference link 1')).toHaveValue('https://www.figma.com/file/again');
    await expect(dialog.getByLabel('Event / Workshop date *')).toHaveValue('');   // dates are left for the new request
    await expect(dialog.getByLabel('Expected delivery date *')).toHaveValue('');
  };

  // From the portal.
  await page.getByRole('button', { name: 'Completed' }).click();
  await page.getByRole('button', { name: /^Request again: Again Fest/ }).click();
  await expectPrefilled();
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  // From the ticket page.
  await page.goto(`/tickets/${id}`);
  await page.getByRole('button', { name: 'Request again' }).click();
  await expectPrefilled();
});

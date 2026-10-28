import { expect, test } from '@playwright/test';
import { USER_BASE, dateInDays } from './helpers';

// Campaigns live only in the User app now, open to everyone: no sign-in to view, add, edit or delete.

test('anyone plans a campaign, logs a post and sees both on the timeline', async ({ page }) => {
  await page.goto(`${USER_BASE}/campaigns`);
  await expect(page.getByRole('heading', { name: 'Campaigns and posts' })).toBeVisible();

  await page.getByRole('button', { name: 'Campaign', exact: true }).click();
  const campaign = page.getByRole('form', { name: 'Campaign' });
  await campaign.getByLabel('Campaign name').fill('Diwali sale');
  await campaign.getByLabel('Starts').fill(dateInDays(-2));
  await campaign.getByLabel('Ends').fill(dateInDays(10));
  await campaign.getByRole('button', { name: 'Add campaign' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Diwali sale' })).toContainText('0 posts');

  await page.getByRole('button', { name: 'Log a post' }).first().click();
  const post = page.getByRole('form', { name: 'Social post' });
  await post.getByLabel('What did you post?').fill('Festival teaser reel');
  await post.getByLabel('Platform').selectOption('LinkedIn');
  await post.getByLabel('Date').fill(dateInDays(1));
  await post.getByLabel('Campaign').selectOption({ label: 'Diwali sale' });
  await post.getByLabel('Link to the post (optional)').fill('https://linkedin.com/posts/abc');
  await post.getByRole('button', { name: 'Save post' }).click();

  await expect(page.getByRole('listitem').filter({ hasText: 'Diwali sale' })).toContainText('1 post');
  await expect(page.getByRole('img', { name: /Festival teaser reel/ })).toBeVisible();   // the dot on the timeline

  await page.getByRole('button', { name: /^Posts \(1\)/ }).click();
  await expect(page.getByText('Festival teaser reel')).toBeVisible();
  await expect(page.getByRole('link', { name: /View post/ })).toHaveAttribute('href', 'https://linkedin.com/posts/abc');
  await page.getByLabel('Filter by platform').selectOption('Instagram');
  await expect(page.getByText('No posts match these filters.')).toBeVisible();
});

test('nobody needs to sign in to see or change what someone else added', async ({ browser }) => {
  // The page above left "Diwali sale" in the shared list; a second, unrelated visitor sees and can edit it.
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`${USER_BASE}/campaigns`);
  await expect(visitor.getByText('Diwali sale').first()).toBeVisible();

  await visitor.getByRole('button', { name: /^Posts/ }).click();
  await expect(visitor.getByText('Festival teaser reel')).toBeVisible();
  await visitor.getByRole('button', { name: 'Edit Festival teaser reel' }).click();
  const post = visitor.getByRole('form', { name: 'Social post' });
  await post.getByLabel('What did you post?').fill('Festival teaser reel (updated)');
  await post.getByRole('button', { name: 'Save changes' }).click();
  await expect(visitor.getByText('Festival teaser reel (updated)')).toBeVisible();

  visitor.once('dialog', d => void d.accept());
  await visitor.getByRole('button', { name: 'Delete Festival teaser reel (updated)' }).click();
  await expect(visitor.getByText('No posts recorded yet')).toBeVisible();
});

test('a post can carry an image, shown without signing in', async ({ page }) => {
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
  await page.goto(`${USER_BASE}/campaigns`);
  await page.getByRole('button', { name: 'Log a post' }).first().click();
  const post = page.getByRole('form', { name: 'Social post' });
  await post.getByLabel('What did you post?').fill('Launch graphic');
  await post.getByLabel('Date').fill(dateInDays(0));
  await post.getByLabel('Upload the post (optional image)').setInputFiles({ name: 'post.png', mimeType: 'image/png', buffer: PNG });
  await post.getByRole('button', { name: 'Save post' }).click();
  await page.getByRole('button', { name: /^Posts/ }).click();
  await expect(page.getByRole('img', { name: 'Image for Launch graphic' })).toBeVisible();
});

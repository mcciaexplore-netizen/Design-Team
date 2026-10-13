import { expect, test } from '@playwright/test';
import { ACCOUNTS, dateInDays, login } from './helpers';

test('a client plans a campaign, logs a post and sees both on the timeline', async ({ page }) => {
  await login(page, ACCOUNTS.client);
  await page.getByRole('link', { name: /Campaigns & posts/ }).click();
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
  await page.screenshot({ path: 'test-results/campaign-timeline.png', fullPage: true });

  await page.getByRole('button', { name: /^Posts \(1\)/ }).click();
  await expect(page.getByText('Festival teaser reel')).toBeVisible();
  await expect(page.getByRole('link', { name: /View post/ })).toHaveAttribute('href', 'https://linkedin.com/posts/abc');
  await page.getByLabel('Filter by platform').selectOption('Instagram');
  await expect(page.getByText('No posts match these filters.')).toBeVisible();
});

test('staff can see the campaigns page but have no way to add to it', async ({ page }) => {
  await login(page, ACCOUNTS.lead);
  await page.getByRole('link', { name: 'Campaigns' }).click();
  await expect(page.getByRole('heading', { name: 'Campaigns and posts' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Log a post' })).toHaveCount(0);
  await expect(page.getByText('Diwali sale').first()).toBeVisible();   // the client's campaign from the previous test
});

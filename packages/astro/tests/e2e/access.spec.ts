import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { siteConfiguration } from '../../lib/project.js';

test('anonymous traffic cannot read protected wiki content', async ({
  request,
}) => {
  const protectedPaths = [
    '/',
    '/favicon.svg',
    '/pagefind/pagefind.js',
    '/missing-phase-0-route',
  ];

  for (const path of protectedPaths) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect([302, 401, 403], path).toContain(response.status());
    expect(await response.text(), path).not.toContain(
      siteConfiguration.brand.siteTitle,
    );
  }
});

test('service-token session can read the synthetic page', async ({ page }) => {
  const clientId = process.env.CF_ACCESS_CLIENT_ID;
  const clientSecret = process.env.CF_ACCESS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    test.skip(true, 'Cloudflare Access service-token credentials are required');
    return;
  }

  await page.setExtraHTTPHeaders({
    'CF-Access-Client-Id': clientId,
    'CF-Access-Client-Secret': clientSecret,
  });
  await page.goto('/');

  await expect(
    page.getByRole('heading', { name: siteConfiguration.brand.siteTitle }),
  ).toBeVisible();

  const accessibilityResults = await new AxeBuilder({ page }).analyze();
  expect(accessibilityResults.violations).toEqual([]);
});

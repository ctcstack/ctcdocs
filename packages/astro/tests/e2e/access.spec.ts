import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { siteConfiguration } from '../../lib/project.js';

/*
 * Which of these suites applies is a property of the deployment, not of the
 * platform. A private deployment must refuse an anonymous reader and admit a
 * machine key (ADR-038); a public portal must do neither. Running the wrong pair would
 * fail a correct deployment, so the configuration decides.
 */
const productionVisibility =
  siteConfiguration.deployment.environments.production.visibility;

test('anonymous traffic cannot read a private deployment', async ({
  request,
}) => {
  test.skip(
    productionVisibility !== 'private',
    'This deployment is published to everyone.',
  );

  const protectedPaths = [
    '/',
    '/pagefind/pagefind.js',
    '/missing-boundary-probe',
  ];

  for (const path of protectedPaths) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect([302, 401, 403], path).toContain(response.status());
    expect(await response.text(), path).not.toContain(
      siteConfiguration.brand.siteTitle,
    );
  }
});

test('anyone may fetch the brand icons of a private deployment', async ({
  request,
}) => {
  test.skip(
    productionVisibility !== 'private',
    'This deployment is published to everyone.',
  );

  // An assistant's connector list fetches them without signing in (ADR-052).
  for (const path of [
    siteConfiguration.brand.faviconPath,
    '/icon-192.png',
    '/favicon.ico',
  ]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(200);
    expect(response.headers()['content-type'], path).toMatch(/^image\//u);
  }
});

test('a machine key reads a private deployment', async ({ page }) => {
  test.skip(
    productionVisibility !== 'private',
    'This deployment is published to everyone.',
  );

  const machineKey = process.env.CTCDOCS_MACHINE_KEY;
  const clientId = process.env.CF_ACCESS_CLIENT_ID;
  const clientSecret = process.env.CF_ACCESS_CLIENT_SECRET;
  const accessToken = clientId && clientSecret;
  if (!machineKey && !accessToken) {
    test.skip(
      true,
      'A machine key (CTCDOCS_MACHINE_KEY) or, while Cloudflare Access still stands in front, its service token is required',
    );
    return;
  }

  await page.setExtraHTTPHeaders({
    ...(machineKey ? { Authorization: `Bearer ${machineKey}` } : {}),
    ...(accessToken
      ? {
          'CF-Access-Client-Id': clientId,
          'CF-Access-Client-Secret': clientSecret,
        }
      : {}),
  });
  await page.goto('/');

  await expect(
    page.getByRole('heading', { name: siteConfiguration.brand.siteTitle }),
  ).toBeVisible();

  const accessibilityResults = await new AxeBuilder({ page }).analyze();
  expect(accessibilityResults.violations).toEqual([]);
});

test('anyone can read a public deployment', async ({ page }) => {
  test.skip(
    productionVisibility !== 'public',
    'This deployment is behind an identity boundary.',
  );

  await page.goto('/');

  await expect(
    page.getByRole('heading', { name: siteConfiguration.brand.siteTitle }),
  ).toBeVisible();

  // A portal that asks search engines to ignore it is a portal nobody finds.
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);

  const accessibilityResults = await new AxeBuilder({ page }).analyze();
  expect(accessibilityResults.violations).toEqual([]);
});

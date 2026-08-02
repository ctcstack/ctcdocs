import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { siteConfiguration } from '../../lib/project.js';
/*
 * Which of these suites applies is a property of the deployment, not of the
 * platform. A private deployment must refuse an anonymous reader and admit a
 * service token; a public portal must do neither. Running the wrong pair would
 * fail a correct deployment, so the configuration decides.
 */
const productionVisibility = siteConfiguration.deployment.environments.production.visibility;
test('anonymous traffic cannot read a private deployment', async ({ request, }) => {
    test.skip(productionVisibility !== 'private', 'This deployment is published to everyone.');
    const protectedPaths = [
        '/',
        siteConfiguration.brand.faviconPath,
        '/pagefind/pagefind.js',
        '/missing-boundary-probe',
    ];
    for (const path of protectedPaths) {
        const response = await request.get(path, { maxRedirects: 0 });
        expect([302, 401, 403], path).toContain(response.status());
        expect(await response.text(), path).not.toContain(siteConfiguration.brand.siteTitle);
    }
});
test('a service-token session reads a private deployment', async ({ page }) => {
    test.skip(productionVisibility !== 'private', 'This deployment is published to everyone.');
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
    await expect(page.getByRole('heading', { name: siteConfiguration.brand.siteTitle })).toBeVisible();
    const accessibilityResults = await new AxeBuilder({ page }).analyze();
    expect(accessibilityResults.violations).toEqual([]);
});
test('anyone can read a public deployment', async ({ page }) => {
    test.skip(productionVisibility !== 'public', 'This deployment is behind an identity boundary.');
    await page.goto('/');
    await expect(page.getByRole('heading', { name: siteConfiguration.brand.siteTitle })).toBeVisible();
    // A portal that asks search engines to ignore it is a portal nobody finds.
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
    const accessibilityResults = await new AxeBuilder({ page }).analyze();
    expect(accessibilityResults.violations).toEqual([]);
});

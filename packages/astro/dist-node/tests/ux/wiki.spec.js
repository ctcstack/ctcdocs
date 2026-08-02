import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { folderAnchorId, folderTrail } from '../../lib/folder-anchor.js';
import { siteConfiguration } from '../../lib/project.js';
import { anyDocument, documentInFolder, documentWithAsset, documentWithTable, } from '../support/corpus-fixtures.js';
async function expectNoAccessibilityViolations(page) {
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
}
test('home page is accessible and search is keyboard operable', async ({ page, }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', {
        name: siteConfiguration.brand.siteTitle,
    })).toBeVisible();
    // The home page opens on folder cards, then what changed, then the full
    // index. Asserted structurally so it does not break when the corpus changes.
    await expect(page.locator('.category-card').first()).toBeVisible();
    await expect(page.locator('.recent-list li').first()).toBeVisible();
    await expect(page.locator('.corpus-group').first()).toBeVisible();
    const firstEntry = page.locator('.corpus-list li').first();
    await expect(firstEntry.getByRole('link')).toBeVisible();
    await expect(firstEntry.locator('time')).toBeVisible();
    await expect(page.getByRole('link', { name: 'About this wiki' }).first()).toBeVisible();
    // Agents are an equal audience, so the machine-readable surface is named on
    // the page and the address it advertises has to resolve.
    const projection = page.locator('.agents-pattern').getByRole('link');
    await expect(projection).toHaveAttribute('href', /\/index\.md$/);
    const theme = page.getByRole('combobox', { name: 'Select theme' });
    await theme.selectOption({ label: 'Light' });
    await expectNoAccessibilityViolations(page);
    await theme.selectOption({ label: 'Dark' });
    await expectNoAccessibilityViolations(page);
    // Scoped to the header: the home page carries a second, larger search
    // control in its opening block.
    const searchButton = page
        .locator('header')
        .getByRole('button', { name: 'Search', exact: true });
    await searchButton.focus();
    await expect(searchButton).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByPlaceholder('Search')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
    // The hero control opens the same dialog rather than mounting a second
    // search, and it is reachable from the keyboard.
    const heroSearch = page.locator('.hero-search');
    await heroSearch.focus();
    await expect(heroSearch).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByPlaceholder('Search')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
});
test('documentation page is accessible and responsive on mobile', async ({ page, }) => {
    /*
     * A page with a table, because the assertion below is about how a table
     * behaves in a narrow frame. Which document has one is a property of the
     * corpus, so it is looked up rather than named.
     */
    const tableDocument = documentWithTable();
    test.skip(!tableDocument, 'The corpus has no document containing a table.');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/${tableDocument?.slug}/`);
    const menuButton = page.getByRole('button', { name: 'Menu' });
    await expect(menuButton).toBeVisible();
    await menuButton.click();
    await expect(page.locator('starlight-menu-button')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('body')).toHaveAttribute('data-mobile-menu-expanded', '');
    // A table fills its frame and scrolls inside it. The scroller is the wrapper
    // rather than the table, because a block-level table scrolls but leaves its
    // cells short of the frame it is drawn in.
    // The first table on the page: a document may carry several, and the
    // assertion is about how the wrapper treats one of them.
    const tableLayout = await page.locator('table').first().evaluate((table) => {
        const wrapper = table.parentElement;
        return {
            display: getComputedStyle(table).display,
            wrapperClass: wrapper?.className,
            wrapperOverflowX: wrapper ? getComputedStyle(wrapper).overflowX : null,
            fillsWrapper: wrapper
                ? Math.abs(table.getBoundingClientRect().width -
                    wrapper.getBoundingClientRect().width) <= 2
                : false,
        };
    });
    expect(tableLayout).toEqual({
        display: 'table',
        wrapperClass: 'kb-table',
        wrapperOverflowX: 'auto',
        fillsWrapper: true,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expectNoAccessibilityViolations(page);
});
test('a synchronized document leads with its position and provenance', async ({ page, }) => {
    const document = documentInFolder();
    test.skip(!document, 'The corpus has no document inside a Drive folder.');
    // Drive folder names reach the manifest with a trailing slash; the page
    // renders them without one.
    const folder = folderTrail(document?.folderPath)[0];
    await page.goto(`/${document?.slug}/`);
    // The trail carries the way home and the Drive folder the document sits in.
    const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(breadcrumb.getByRole('link', { name: 'Home' })).toBeVisible();
    const folderLink = breadcrumb.getByRole('link', { name: folder });
    await expect(folderLink).toBeVisible();
    // Provenance sits above the body, not in the footer: a reader needs to know
    // how fresh a document is before reading it.
    const meta = page.locator('.doc-meta');
    await expect(meta).toBeVisible();
    const metaBox = await meta.boundingBox();
    const contentBox = await page.locator('.sl-markdown-content').boundingBox();
    expect(metaBox && contentBox && metaBox.y < contentBox.y).toBe(true);
    await expect(page.getByRole('button', { name: 'Copy as Markdown' })).toBeVisible();
    // The footer no longer repeats a date under a different meaning.
    await expect(page.locator('footer time')).toHaveCount(0);
    await expectNoAccessibilityViolations(page);
    /*
     * The folder segment leads somewhere that presents that folder, and the
     * corpus decides which: its own page where section index pages are
     * generated, and the folder's heading in the home index where they are not.
     * The link is followed rather than compared to one expected address, because
     * a test that pins one arrangement fails the day the corpus is built with
     * the other — which is exactly how this assertion broke.
     */
    const folderHref = (await folderLink.getAttribute('href')) ?? '';
    await folderLink.click();
    if (folderHref.startsWith('/#')) {
        expect(folderHref).toBe(`/#${folderAnchorId(folder)}`);
        // Percent-encoded, so it cannot go in a bare CSS identifier selector.
        await expect(page.locator(`[id="${folderAnchorId(folder)}"]`)).toBeVisible();
    }
    else {
        await expect(page.getByRole('heading', { level: 1, name: folder, exact: true })).toBeVisible();
    }
});
test('generated documents expose their protected Markdown projection', async ({ page, request, }) => {
    const document = anyDocument();
    await page.goto(`/${document.slug}/`);
    const markdownLink = page.getByRole('link', { name: 'View as Markdown' });
    await expect(markdownLink).toHaveAttribute('href', `/${document.slug}/index.md`);
    const markdown = await request.get(`/${document.slug}/index.md`);
    expect(markdown.ok()).toBe(true);
    expect(markdown.headers()['content-type']).toContain('text/markdown');
    const source = await markdown.text();
    expect(source).toContain(`title: ${JSON.stringify(document.title)}`);
    expect(source).toContain('content_hash: "sha256:');
    expect(source).toMatch(/^# .+$/mu);
    expect(source).not.toContain('AUTO-GENERATED');
    expect(source).not.toContain('googleFileId');
});
test('generated images are served from the protected asset route', async ({ request, }) => {
    const sample = documentWithAsset();
    test.skip(!sample, 'The corpus carries no generated images.');
    const asset = await request.get(sample?.assetPath);
    expect(asset.ok()).toBe(true);
    expect(asset.headers()['content-type']).toMatch(/^image\//u);
});
test('crawler defenses are present in the built site', async ({ page, request, }) => {
    await page.goto('/');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow, noarchive');
    const robots = await request.get('/robots.txt');
    expect(robots.ok()).toBe(true);
    expect(await robots.text()).toContain('Disallow: /');
});

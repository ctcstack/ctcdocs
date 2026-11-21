import { AxeBuilder } from '@axe-core/playwright';
import {
  ACCESS_CLASSES_ROUTE,
  ACCESS_READER_ROUTE,
  DOCUMENT_FORMAT_BADGES,
  PLATFORM_ROUTE_HREFS,
} from '@ctcstack/ctcdocs-core';
import { expect, test, type Page } from '@playwright/test';
import type { Root, RootContent } from 'mdast';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

import {
  folderAnchorId,
  folderTrail,
  normalizeFolderName,
} from '../../lib/folder-anchor.js';
import { asksNothing } from '../../lib/content-health-view.js';
import { siteConfiguration } from '../../lib/project.js';
import {
  accessReviewShape,
  anyDocument,
  contentHealthReport,
  deepestDocument,
  folderAccessFindingCount,
  searchBundlesOfEveryClass,
  unpublishedReport,
  documentInFolder,
  documentLinkingAnother,
  documentWithAsset,
  documentWithMostHeadings,
  documentWithPermanentLink,
  documentWithTable,
  folderPages,
  mediaDocuments,
  pdfDocument,
  sectionWithSubfolder,
  sheetDocuments,
} from '../support/corpus-fixtures.js';

/*
 * The classes route belongs to the Worker (ADR-038, ADR-039), which the static
 * server the suite runs against does not have. Answering it as the Worker
 * would for an admin keeps every document searchable, as it was before
 * search was split by class.
 */
test.beforeEach(async ({ page }) => {
  const bundles = searchBundlesOfEveryClass();
  await page.route(`**${ACCESS_CLASSES_ROUTE}`, (route) =>
    route.fulfill({ json: { bundles } }),
  );
});

/** Every link destination in a Markdown document, read by a real parser. */
function markdownLinks(markdown: string): string[] {
  const urls: string[] = [];
  const walk = (node: Root | RootContent): void => {
    if (node.type === 'link') {
      urls.push(node.url);
    }
    if ('children' in node) {
      node.children.forEach(walk);
    }
  };
  walk(unified().use(remarkParse).parse(markdown));
  return urls;
}

/** Folder labels are Drive names, so they may carry pattern syntax. */
function escapeRegExp(value: string): string {
  return value.replace(/[$()*+.?[\\\]^{|}]/gu, '\\$&');
}

/**
 * `include` narrows the audit to the platform's own controls on a page that
 * a test picks for its content: the document with the most headings or with
 * an image is a deployment's own, and how its author used headings is not
 * the control's to answer for.
 */
async function expectNoAccessibilityViolations(
  page: Page,
  include: string[] = [],
): Promise<void> {
  /*
   * Audit the page once it has settled. Switching the theme changes a link's
   * text at once and fades its background over 150ms, so a check in between
   * measures a frame no reader stops on. Only running animations with an end
   * are waited for, and for two seconds at most: an endless or paused one
   * would otherwise keep the audit from ever starting.
   */
  await page.evaluate(() =>
    Promise.race([
      Promise.all(
        document
          .getAnimations()
          .filter(
            (animation) =>
              animation.playState === 'running' &&
              animation.effect?.getComputedTiming().endTime !== Infinity,
          )
          .map((animation) => animation.finished.catch(() => undefined)),
      ),
      new Promise((settled) => setTimeout(settled, 2000)),
    ]),
  );
  let builder = new AxeBuilder({ page });
  for (const selector of include) {
    builder = builder.include(selector);
  }
  const results = await builder.analyze();
  expect(results.violations).toEqual([]);
}

/**
 * Shows the page in one theme with the header's theme button, which switches
 * between the two: pressed only when the page shows the other one.
 */
async function chooseTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  const root = page.locator('html');
  if ((await root.getAttribute('data-theme')) !== theme) {
    await page
      .locator('header')
      .getByRole('button', { name: 'Dark theme' })
      .click();
  }
  await expect(root).toHaveAttribute('data-theme', theme);
}

test('home page is accessible and search is keyboard operable', async ({
  page,
}) => {
  await page.goto('/');

  await expect(
    page.getByRole('heading', {
      name: siteConfiguration.brand.siteTitle,
    }),
  ).toBeVisible();

  // The home page opens on folder cards, then what changed, then the full
  // index. Asserted structurally so it does not break when the corpus changes.
  await expect(page.locator('.category-card').first()).toBeVisible();
  const recentRows = page.locator('.recent-list li');
  await expect(recentRows.first()).toBeVisible();

  // The band stops where the project asked it to. A corpus smaller than the
  // limit is the shorter list, which is the limit doing its job too.
  const { corpusIndex, recentLimit } = siteConfiguration.home;
  expect(await recentRows.count()).toBeLessThanOrEqual(recentLimit);

  /*
   * Whether the index is on this page is the project's choice, and the page
   * ends on the whole corpus either way: it carries the index, or it links to
   * the page that does.
   */
  if (corpusIndex) {
    await expect(page.locator('.corpus-group').first()).toBeVisible();
    const firstEntry = page.locator('.corpus-list li').first();
    await expect(firstEntry.getByRole('link')).toBeVisible();
    await expect(firstEntry.locator('time')).toBeVisible();
  } else {
    await expect(page.locator('.corpus-group')).toHaveCount(0);
    await expect(page.locator('.full-index').getByRole('link')).toHaveAttribute(
      'href',
      '/documents/',
    );
  }
  const { start } = siteConfiguration.home;
  if (start === undefined) {
    await expect(page.locator('.hero-onboarding')).toHaveCount(0);
  } else {
    await expect(
      page.locator('.hero-onboarding').getByRole('link'),
    ).toHaveAttribute('href', `/${start}/`);
  }

  // Agents are an equal audience, so the machine-readable surface is named on
  // the page and the address it advertises has to resolve.
  const projection = page.locator('.agents-pattern').getByRole('link');
  await expect(projection).toHaveAttribute('href', /\/index\.md$/);

  await chooseTheme(page, 'light');
  await expectNoAccessibilityViolations(page);
  await chooseTheme(page, 'dark');
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

test('the full index is a page of its own, whatever the home page shows', async ({
  page,
}) => {
  await page.goto('/documents/');

  await expect(
    page.getByRole('heading', { level: 1, name: 'All documents' }),
  ).toBeVisible();

  // Every folder is a heading a link can address, and every row is a document
  // with the date its source was last edited.
  const folder = folderTrail(documentInFolder()?.folderPath)[0];
  if (folder) {
    await expect(
      page.locator(`[id="${folderAnchorId(folder)}"]`),
    ).toBeVisible();
  }
  const firstEntry = page.locator('.corpus-list li').first();
  await expect(firstEntry.getByRole('link')).toBeVisible();
  await expect(firstEntry.locator('time')).toBeVisible();

  /*
   * The page lists every title in the corpus, so indexing the lists would
   * return it alongside every real result.
   */
  await expect(
    page.locator('.corpus-list:not([data-pagefind-ignore])'),
  ).toHaveCount(0);

  await expectNoAccessibilityViolations(page);
});

test('documentation page is accessible and responsive on mobile', async ({
  page,
}) => {
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
  await expect(page.locator('starlight-menu-button')).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(page.locator('body')).toHaveAttribute(
    'data-mobile-menu-expanded',
    '',
  );

  /*
   * A table never leaves its frame short, and never takes the page with it
   * when it exceeds one: it fills the wrapper, or it is wider and the wrapper
   * is what scrolls. The scroller is the wrapper rather than the table,
   * because a block-level table scrolls but leaves its cells short of the
   * frame it is drawn in.
   *
   * Demanding that the width match exactly would fail every table too wide for
   * a phone — which is the case the wrapper exists for, and the case a real
   * corpus produces as soon as a document carries more than three columns.
   *
   * The first table on the page: a document may carry several, and the
   * assertion is about how the wrapper treats one of them.
   */
  const tableLayout = await page
    .locator('table')
    .first()
    .evaluate((table) => {
      const wrapper = table.parentElement;
      const tableWidth = table.getBoundingClientRect().width;
      const wrapperWidth = wrapper?.getBoundingClientRect().width ?? 0;
      return {
        display: getComputedStyle(table).display,
        wrapperClass: wrapper?.className,
        wrapperOverflowX: wrapper ? getComputedStyle(wrapper).overflowX : null,
        narrowerThanWrapper: wrapper ? tableWidth < wrapperWidth - 2 : true,
        overflowStaysInsideWrapper: wrapper
          ? tableWidth <= wrapperWidth + 2 ||
            wrapper.scrollWidth > wrapper.clientWidth
          : false,
      };
    });
  expect(tableLayout).toEqual({
    display: 'table',
    wrapperClass: 'kb-table',
    wrapperOverflowX: 'auto',
    narrowerThanWrapper: false,
    overflowStaysInsideWrapper: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expectNoAccessibilityViolations(page);
});

test('a synchronized document leads with its position and provenance', async ({
  page,
}) => {
  const document = documentInFolder();
  test.skip(!document, 'The corpus has no document inside a Drive folder.');
  // Drive folder names reach the manifest with a trailing slash; the page
  // renders them without one.
  const folder = folderTrail(document?.folderPath)[0] as string;

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

  await expect(
    page.getByRole('button', { name: 'Copy as Markdown' }),
  ).toBeVisible();

  // The footer no longer repeats a date under a different meaning.
  await expect(page.locator('footer time')).toHaveCount(0);

  await expectNoAccessibilityViolations(page);

  /*
   * The folder segment leads somewhere that presents that folder, and the
   * corpus decides which: its own page where section index pages are
   * generated, and its heading in the full index where they are not. The link
   * is followed rather than compared to one expected address, because a test
   * that pins one arrangement fails the day the corpus is built with the
   * other — which is exactly how this assertion broke.
   */
  const folderHref = (await folderLink.getAttribute('href')) ?? '';
  await folderLink.click();
  if (folderHref.includes('#')) {
    expect(folderHref).toBe(`/documents/#${folderAnchorId(folder)}`);
    // Percent-encoded, so it cannot go in a bare CSS identifier selector.
    await expect(
      page.locator(`[id="${folderAnchorId(folder)}"]`),
    ).toBeVisible();
  } else {
    await expect(
      page.getByRole('heading', { level: 1, name: folder, exact: true }),
    ).toBeVisible();
  }
});

/** A computed length in pixels for a value written in rem. */
async function remInPixels(page: Page, rem: number): Promise<string> {
  const rootSize = await page.evaluate(() =>
    Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
  );
  return `${rootSize * rem}px`;
}

/*
 * Starlight's reset zeroes every margin from `starlight.reset`, and the
 * platform's component rules outrank it only while that layer is declared
 * before them. The bundler can link a stylesheet of component rules ahead of
 * Starlight's own declaration, so the order is declared inline in the head;
 * a margin the platform sets is where losing it shows. Both layers the
 * platform writes to are checked: `starlight.components` on the home page and
 * `starlight.core` under a document title.
 */
test('platform styles outrank the Starlight reset on every kind of page', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.recent-icon').first()).toHaveCSS(
    'margin-inline-end',
    await remInPixels(page, 0.5),
  );

  await page.goto(`/${anyDocument().slug}/`);
  await expect(page.locator('h1#_top')).toHaveCSS(
    'margin-top',
    await remInPixels(page, 1),
  );
});

test('a section page tells its folders from its documents', async ({
  page,
}) => {
  const section = sectionWithSubfolder();
  test.skip(!section, 'The corpus has no section page listing a subfolder.');
  if (!section) return;
  const { subfolder } = section;

  await page.goto(`/${section.slug}/`);

  /*
   * A page generated before its entries were recorded keeps the Markdown list
   * in its body, and that list still has to lead to the subfolder.
   */
  if (!section.recordsEntries) {
    await expect(page.locator('.section-list')).toHaveCount(0);
    await expect(
      page
        .locator('.sl-markdown-content > ul')
        .locator(`a[href="/${subfolder.slug}/"]`),
    ).toHaveText(subfolder.label);
    return;
  }

  // The listing is drawn from the page's entries, not its Markdown fallback.
  const list = page.locator('.section-list');
  await expect(list).toBeVisible();
  await expect(page.locator('.sl-markdown-content > ul')).toHaveCount(1);

  /*
   * The folder glyph is decorative, so what the row is has to reach a screen
   * reader as text too — and a folder row says how much it holds, which is
   * how an empty one is visible before anyone opens it.
   */
  const folderRow = list.locator('li[data-kind="folder"]', {
    has: page.locator(`a[href="/${subfolder.slug}/"]`),
  });
  await expect(folderRow).toHaveCount(1);
  const folderLink = folderRow.getByRole('link');
  await expect(folderLink).toHaveAccessibleName(
    new RegExp(`^${escapeRegExp(subfolder.label)} \\(folder\\)`, 'u'),
  );
  await expect(folderRow.locator('.section-entry-meta')).toHaveText(
    /^(Empty|1 document|\d+ documents)$/u,
  );

  await chooseTheme(page, 'light');
  await expectNoAccessibilityViolations(page);
  await chooseTheme(page, 'dark');
  await expectNoAccessibilityViolations(page);

  await folderLink.click();
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: subfolder.label,
      exact: true,
    }),
  ).toBeVisible();
});

test('a folder with no landing document opens with its own page', async ({
  page,
}) => {
  const folders = folderPages();
  test.skip(folders.length === 0, 'The project generates no folder pages.');
  const [label] = siteConfiguration.navigation.landingDocumentTitles;

  // A folder opened by a landing document keeps its page out of the sidebar;
  // any other lists the page first, named like the first landing title, and
  // names its folder to screen readers.
  let listed = 0;
  for (const folder of folders.slice(0, 10)) {
    await page.goto(`/${folder.slug}/`);
    const current = page.locator('#starlight__sidebar a[aria-current="page"]');
    if ((await current.count()) === 0) {
      continue;
    }
    await expect(current).toHaveText(label ?? '');
    await expect(current).toHaveAttribute('href', `/${folder.slug}/`);
    const named = `${normalizeFolderName(folder.label)}: ${label ?? ''}`;
    await expect(current).toHaveAttribute('aria-label', named);

    // The page before it links on to it by that name, not a bare label.
    const previous = page.locator('.pagination-links a[rel="prev"]');
    if (listed === 0 && (await previous.count()) > 0) {
      await page.goto((await previous.getAttribute('href')) ?? '/');
      await expect(
        page.locator('.pagination-links a[rel="next"] .link-title'),
      ).toHaveText(named);
    }
    listed += 1;
  }
  test.skip(listed === 0, 'Every folder here opens with a landing document.');
});

test('generated documents expose their protected Markdown projection', async ({
  page,
  request,
}) => {
  const document = anyDocument();
  await page.goto(`/${document.slug}/`);

  const markdownLink = page.getByRole('link', { name: 'View as Markdown' });
  await expect(markdownLink).toHaveAttribute(
    'href',
    `/${document.slug}/index.md`,
  );

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

test('agents find every document through the llms.txt indexes', async ({
  page,
  request,
}) => {
  const document = anyDocument();

  const response = await request.get('/llms.txt');
  expect(response.ok()).toBe(true);
  expect(response.headers()['content-type']).toContain('text/plain');
  const index = await response.text();
  expect(index).toMatch(/^# .+$/mu);
  const links = markdownLinks(index);
  expect(links).toContain(`/${document.slug}/index.md`);

  // Every section index the site index links to is served and lists documents.
  for (const path of links.filter((url) => url.endsWith('/llms.txt'))) {
    const section = await request.get(path);
    expect(section.ok(), path).toBe(true);
    expect(
      markdownLinks(await section.text()).some((url) =>
        url.endsWith('/index.md'),
      ),
      path,
    ).toBe(true);
  }

  // A document's page names its Markdown version and the index, and says what
  // it is in terms an agent can read without the interface.
  await page.goto(`/${document.slug}/`);
  await expect(
    page.locator('head link[rel="alternate"][type="text/markdown"]'),
  ).toHaveAttribute('href', `/${document.slug}/index.md`);
  await expect(
    page.locator('head link[rel="alternate"][type="text/plain"]'),
  ).toHaveAttribute('href', '/llms.txt');
  const structured = JSON.parse(
    (await page
      .locator('head script[type="application/ld+json"]')
      .textContent()) ?? '',
  ) as Record<string, unknown>;
  expect(structured).toMatchObject({
    '@type': 'WebPage',
    name: document.title,
    encoding: { encodingFormat: 'text/markdown' },
  });
});

test('generated images are served from the protected asset route', async ({
  request,
}) => {
  const sample = documentWithAsset();
  test.skip(!sample, 'The corpus carries no generated images.');

  const asset = await request.get(sample?.assetPath as string);
  expect(asset.ok()).toBe(true);
  expect(asset.headers()['content-type']).toMatch(/^image\//u);
});

test('the account menu names the reader and signs them out through the Worker', async ({
  page,
}) => {
  test.skip(
    siteConfiguration.deployment.environments.production.visibility !==
      'private',
    'A public deployment has no session to end.',
  );
  // The Worker answers the address from the reader's session (ADR-038).
  let asked = 0;
  await page.route(`**${ACCESS_READER_ROUTE}`, (route) => {
    asked += 1;
    return route.fulfill({ json: { email: 'jane.doe@example.com' } });
  });
  await page.goto('/');

  const account = page
    .locator('header')
    .getByRole('button', { name: 'Account: jane.doe@example.com' });
  await expect(account).toHaveText('JD');
  await account.click();

  const menu = page.locator('#kb-account');
  await expect(menu).toBeVisible();
  await expect(menu).toContainText('jane.doe@example.com');
  const form = menu.locator('form.sign-out');
  await expect(form).toHaveAttribute('method', 'post');
  await expect(form).toHaveAttribute('action', '/auth/sign-out');
  await expect(form.getByRole('button', { name: 'Sign out' })).toBeVisible();

  // The menu sits under its button, inside the window.
  const button = await account.boundingBox();
  const panel = await menu.boundingBox();
  expect(panel && button && panel.y >= button.y + button.height).toBe(true);
  expect(
    panel && panel.x + panel.width <= (page.viewportSize()?.width ?? 0),
  ).toBe(true);

  for (const theme of ['light', 'dark'] as const) {
    await page.keyboard.press('Escape');
    await chooseTheme(page, theme);
    await account.click();
    await expectNoAccessibilityViolations(page, ['header', '#kb-account']);
  }
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  // The next page shows the address it kept, without asking again.
  await page.goto(`/${anyDocument().slug}/`);
  await expect(account).toHaveText('JD');
  expect(asked).toBe(1);
});

test('without an answer from the Worker, the account menu still signs out', async ({
  page,
}) => {
  test.skip(
    siteConfiguration.deployment.environments.production.visibility !==
      'private',
    'A public deployment has no session to end.',
  );
  await page.route(`**${ACCESS_READER_ROUTE}`, (route) =>
    route.fulfill({ status: 404, body: 'Not found' }),
  );
  await page.goto('/');
  const account = page
    .locator('header')
    .getByRole('button', { name: 'Account', exact: true });
  await account.click();
  const menu = page.locator('#kb-account');
  await expect(menu.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await expect(menu.getByText('Signed in as')).toBeHidden();
});

test('the theme button switches the theme, and the choice holds across pages', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const toggle = page
    .locator('header')
    .getByRole('button', { name: 'Dark theme' });
  await chooseTheme(page, 'light');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');

  // Back to the system's theme, the site follows the system again.
  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(
    await page.evaluate(() => localStorage.getItem('starlight-theme')),
  ).toBeNull();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test("the switcher offers the organization's other sites beside the name", async ({
  page,
}) => {
  const { switcher, brand } = siteConfiguration;
  test.skip(!switcher, 'The project configures no switcher.');

  await page.goto('/');
  const button = page
    .locator('header')
    .getByRole('button', { name: `Switch to another ${brand.name} site` });
  // New to this reader, so it says so; once opened, it no longer does.
  await expect(button).toHaveAttribute('data-new', '');

  await button.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('navigation', {
    name: `Switch to another ${brand.name} site`,
  });
  await expect(menu).toBeVisible();
  const links = menu.getByRole('link');
  await expect(links).toHaveCount(1 + (switcher?.sites.length ?? 0));
  await expect(links.first()).toHaveAttribute('aria-current', 'page');
  await expect(links.first()).toContainText(brand.siteTitle);
  for (const [index, site] of (switcher?.sites ?? []).entries()) {
    const link = links.nth(index + 1);
    await expect(link).toHaveAttribute('href', site.url);
    await expect(link).toContainText(site.name);
    if (site.description) {
      await expect(link).toContainText(site.description);
    }
  }

  for (const theme of ['light', 'dark'] as const) {
    await page.keyboard.press('Escape');
    await chooseTheme(page, theme);
    await button.click();
    await expectNoAccessibilityViolations(page, ['header', '#kb-switcher']);
  }
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(button).not.toHaveAttribute('data-new', '');
  await page.reload();
  await expect(button).not.toHaveAttribute('data-new', '');
});

test('on a phone the header keeps the whole name, the theme and the account', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of ['/', `/${anyDocument().slug}/`]) {
    await page.goto(path);
    const header = page.locator('header');
    await expect(
      header.getByRole('button', { name: 'Dark theme' }),
    ).toBeVisible();
    if (
      siteConfiguration.deployment.environments.production.visibility ===
      'private'
    ) {
      await expect(
        header.getByRole('button', { name: /^Account/u }),
      ).toBeVisible();
    }
    const name = header.locator('.site-title span');
    expect(
      await name.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
});

test('crawler defenses are present in the built site', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    'content',
    'noindex, nofollow, noarchive',
  );

  const robots = await request.get('/robots.txt');
  expect(robots.ok()).toBe(true);
  expect(await robots.text()).toContain('Disallow: /');
});

test('a permanent link leads to its page, which offers to copy it', async ({
  page,
}) => {
  const document = documentWithPermanentLink();
  test.skip(!document, 'The corpus was synchronized before permanent links.');
  const { shortId, slug } = document as { shortId: string; slug: string };

  await page.goto(`/d/${shortId}/`);
  await expect(page).toHaveURL(new RegExp(`/${escapeRegExp(slug)}/$`, 'u'));
  await expect(page.locator('copy-link').first()).toHaveAttribute(
    'data-path',
    `/d/${shortId}/`,
  );
});

test('a link between documents goes straight to the current address', async ({
  page,
}) => {
  const linking = documentLinkingAnother();
  test.skip(!linking, 'No document in the corpus links to another page.');
  const { source, targetSlug } = linking as {
    source: { slug: string };
    targetSlug: string;
  };

  await page.goto(`/${source.slug}/`);
  const content = page.locator('.sl-markdown-content');
  await expect(
    content.locator(`a[href^="/${targetSlug}/"]`).first(),
  ).toBeVisible();
  await expect(content.locator('a[href^="/d/"]')).toHaveCount(0);
});

test('a missing address searches for the page it named', async ({ page }) => {
  /*
   * Deep in folders, because a folder's name is indexed where the folder has
   * its address: a search that took the folders' words would offer that page
   * instead of the document.
   */
  const document = deepestDocument();

  // The hexadecimal tail stands for an address a rename has since replaced.
  await page.goto(`/${document.slug}--0a0b0c/`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Page not found' }),
  ).toBeVisible();
  await expect(
    page
      .locator('missing-page [data-result-list] a')
      .filter({ hasText: document.title })
      .first(),
  ).toBeVisible();
  await expectNoAccessibilityViolations(page);
});

test('the content health page links each issue to its document', async ({
  page,
}) => {
  await page.goto('/content-health/');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Content health' }),
  ).toBeVisible();
  const report = contentHealthReport();
  test.skip(
    !report || report.issueCount === 0,
    'The corpus has no content health report with issues yet.',
  );
  const { linkedIssueCount, sections } = report as {
    linkedIssueCount: number;
    sections: string[];
  };

  const sourceLinks = page.locator(
    'content-health a[href^="https://docs.google.com/document/d/"]',
  );
  await expect(sourceLinks.first()).toBeAttached();
  if (linkedIssueCount > 0) {
    await expect(
      page.locator('content-health a[href*="/edit#heading="]').first(),
    ).toBeAttached();
  }
  await chooseTheme(page, 'light');
  await expectNoAccessibilityViolations(page);
  await chooseTheme(page, 'dark');
  await expectNoAccessibilityViolations(page);

  // Narrowing to one section leaves only that section's files, and the
  // address keeps the choice.
  const [section] = sections;
  await page.getByLabel('Section', { exact: true }).selectOption(section ?? '');
  await expect(page).toHaveURL(/[?&]section=/u);
  const tasks = page.locator('content-health [data-group] li');
  const visible = tasks.filter({ visible: true });
  const expand = page.getByRole('button', { name: 'Expand all' });
  if (await expand.isVisible()) await expand.click();
  await expect(visible.first()).toBeVisible();
  for (const item of await visible.all()) {
    await expect(item).toHaveAttribute('data-section', section ?? '');
  }

  // Every count on the page follows the filter: each priority's count is the
  // number of its tasks still shown.
  for (const tier of await page.locator('content-health [data-tier]').all()) {
    const id = (await tier.getAttribute('id')) ?? '';
    const count = tier.locator(`[data-tier-count="${id}"]`);
    if ((await count.count()) === 0) continue;
    await expect(count).toHaveText(
      String(await tier.locator('[data-group] li:not([hidden])').count()),
    );
  }

  // The address alone brings the same view back.
  await page.reload();
  await expect(page.getByLabel('Section', { exact: true })).toHaveValue(
    section ?? '',
  );
});

test('the content health page ranks what it found, most urgent first', async ({
  page,
}) => {
  const report = contentHealthReport();
  const unpublished = unpublishedReport();
  test.skip(
    !report && !unpublished,
    'The corpus has no content health report yet.',
  );

  await page.goto('/content-health/');
  await expect(
    page.locator('content-health [data-tier] > h2 > span:first-of-type'),
  ).toHaveText([
    'Fix now',
    'Fix next',
    'Improve',
    'Tidy up',
    'Proposed convention: one Title line',
    ...(folderAccessFindingCount() > 0 ? ['Folder access'] : []),
    ...((unpublished?.ignoredFolders ?? 0) > 0 ? ['Left out on purpose'] : []),
  ]);

  // A group folded to its summary opens from a link to it.
  const folded = page.locator('content-health details[data-group]:not([open])');
  test.skip(
    (await folded.count()) === 0,
    'Every group on the page starts open.',
  );
  const id = (await folded.first().getAttribute('id')) ?? '';
  await page.goto(`/content-health/#${id}`);
  await expect(page.locator(`details[id="${id}"]`)).toHaveAttribute('open', '');
});

test('the content health page names every check and note it has findings for', async ({
  page,
}) => {
  const titles = [
    ...(contentHealthReport()?.failedCheckTitles ?? []),
    ...(unpublishedReport()?.noteTitles ?? []),
  ];
  test.skip(titles.length === 0, 'The corpus has nothing to check or note.');

  await page.goto('/content-health/');
  for (const title of titles) {
    await expect(
      page.locator('main').getByText(title, { exact: true }).first(),
      title,
    ).toBeAttached();
  }
});

test('the content health page names what is not on the site, and every note', async ({
  page,
}) => {
  const report = unpublishedReport();
  test.skip(
    !report || report.items.length + report.notes.length === 0,
    'The corpus has nothing off the site and nothing to note.',
  );
  const { items, notes } = report as NonNullable<typeof report>;

  await page.goto('/content-health/');
  for (const item of items) {
    const entry = page.locator(
      `content-health li[data-kind="unpublished"]:has(a[href="${item.sourceUrl}"])`,
    );
    if (asksNothing(item.reason)) {
      // Named in the report, and not given to an editor as work.
      await expect(entry).toHaveCount(0);
      continue;
    }
    await expect(entry).toHaveCount(1);
    await expect(entry).toContainText(item.name);
    await expect(entry.locator('xpath=ancestor::details[1]')).toHaveAttribute(
      'id',
      /^not-on-the-site-/u,
    );
    if (item.slug) {
      await expect(entry.locator(`a[href="/${item.slug}/"]`)).toBeAttached();
    }
  }
  for (const note of notes) {
    await expect(
      page
        .locator(
          `content-health li[data-kind="note"]:has(a[href="${note.sourceUrl}"])`,
        )
        .first(),
    ).toContainText(note.name);
  }
});

test('the access review shows who may read each folder, and reads as a group', async ({
  page,
}) => {
  const shape = accessReviewShape();
  if (!shape) {
    // Without access rules there is nothing to review, and no page.
    const response = await page.goto('/access-review/');
    expect(response?.status()).toBe(404);
    return;
  }

  await page.goto('/access-review/');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Access review' }),
  ).toBeVisible();
  const rows = page.locator('access-review tr[data-row]');
  await expect(rows).toHaveCount(shape.rows);
  for (const group of shape.groups) {
    await expect(
      page.locator(`access-review thead th[data-col="${group}"]`),
    ).toHaveCount(1);
  }
  expect(
    await page.locator('access-review .review-attention-list li').count(),
  ).toBeGreaterThanOrEqual(shape.findings);

  await chooseTheme(page, 'light');
  await expectNoAccessibilityViolations(page);
  await chooseTheme(page, 'dark');
  await expectNoAccessibilityViolations(page);

  // Reading as a group marks every folder it cannot open, and the address
  // keeps the choice.
  const [group] = shape.groups;
  if (group) {
    const readAs = page.getByRole('group', { name: 'Read as' });
    await readAs.getByRole('button', { name: group, exact: true }).click();
    await expect(page).toHaveURL(
      new RegExp(`#as=${escapeRegExp(group)}$`, 'u'),
    );
    await expect(page.getByRole('status')).toContainText('may open');
    for (const row of await rows.all()) {
      const readers = (await row.getAttribute('data-readers')) ?? '';
      const reads = readers === '*' || readers.split(' ').includes(group);
      if (reads) {
        await expect(row).not.toHaveAttribute('data-closed');
      } else {
        await expect(row).toHaveAttribute('data-closed');
      }
    }
    await page.reload();
    await expect(
      readAs.getByRole('button', { name: group, exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(page).toHaveURL(/\/access-review\/$/u);
  }

  // Finding a document by its title shows it in its folder's row.
  const sample = anyDocument();
  await page.getByLabel('Find a document or folder').fill(sample.title);
  await expect(
    page
      .locator('access-review li[data-hit]')
      .filter({ hasText: sample.title })
      .first(),
  ).toBeVisible();

  // A link to a folder the search has filtered out lifts the search.
  const find = page.getByLabel('Find a document or folder');
  await find.fill('no folder or document is called this');
  await expect(rows.filter({ visible: true })).toHaveCount(0);
  const link = page.locator('access-review a[data-goto]').first();
  if ((await link.count()) > 0) {
    const target = ((await link.getAttribute('href')) ?? '').slice(1);
    await link.click();
    await expect(find).toHaveValue('');
    await expect(
      page.locator(`access-review tr[id="${target}"]`),
    ).toBeVisible();
  }
  await find.fill('');

  // The admin groups read everything, so the page never reads as one.
  for (const admin of shape.admins) {
    await expect(
      page.locator(`access-review button[data-as="${admin}"]`),
    ).toHaveCount(0);
  }

  // "Hide" leaves no document the reader cannot open, folder or not.
  if (group) {
    await page
      .getByRole('group', { name: 'Read as' })
      .getByRole('button', { name: group, exact: true })
      .click();
    await page.getByLabel('Hide what they cannot read').check();
    for (const details of await page
      .locator('access-review tr[data-row]:visible [data-documents]')
      .all()) {
      await details.evaluate((element) => {
        (element as HTMLDetailsElement).open = true;
      });
    }
    await expect(
      page.locator('access-review li[data-closed]:visible'),
    ).toHaveCount(0);
  }
});

test('the access review lays what holds now over the rules', async ({
  page,
}) => {
  const shape = accessReviewShape();
  test.skip(!shape?.groups.length, 'The project names no group in a rule.');
  const { groups, admins, classes } = shape as NonNullable<typeof shape>;
  const [shut = '', other = shut] = groups;
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  // The Worker answers the status route; the static server the suite runs
  // against does not, so it answers here as the Worker would for an admin.
  await page.route('**/_kb/status', (route) =>
    route.fulfill({
      json: {
        takenAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
        ageSeconds: 240,
        stale: false,
        activeUsers: 12,
        groups: Object.fromEntries(
          [...groups, ...admins].map((group) => [
            group,
            group === shut
              ? { members: 3, admitsNoOne: 'it lets people join themselves' }
              : { members: 3 },
          ]),
        ),
        classes: Object.fromEntries(classes.map((id) => [id, 4])),
        machineKeys: [
          {
            name: 'smoke',
            owner: 'ops@example.com',
            groups: [other],
            expires: expires.toISOString(),
          },
        ],
      },
    }),
  );
  await page.goto('/access-review/');

  await expect(page.locator('access-review [data-live]')).toContainText(
    'Group membership was read',
  );
  // A group that admits no one says so in its column and right now.
  await expect(
    page.locator(`access-review thead th[data-col="${shut}"]`),
  ).toContainText('admits no one');
  const now = page.getByRole('region', { name: /Right now/u });
  await expect(now).toBeVisible();
  await expect(now).toContainText(shut);
  // Every folder says how many people may read it.
  for (const row of await page.locator('access-review tr[data-row]').all()) {
    await expect(row.locator('[data-people]')).toHaveText('4 people');
  }
  // The keys are listed, and the page reads as one.
  await expect(
    page.getByRole('region', { name: 'Machine keys' }),
  ).toContainText('smoke');
  await page
    .getByRole('group', { name: 'Or as a machine key' })
    .getByRole('button', { name: 'smoke' })
    .click();
  await expect(page.getByRole('status')).toContainText(
    'The key smoke may open',
  );
  await expect(page).toHaveURL(/#machine=smoke$/u);
  // A search keeps reading as the key.
  const readable = await page.getByRole('status').textContent();
  await page.getByLabel('Find a document or folder').fill(anyDocument().title);
  await expect(page.getByRole('status')).toContainText(
    readable?.split('.')[0] ?? 'The key smoke may open',
  );
  await page.getByLabel('Find a document or folder').fill('');

  await chooseTheme(page, 'light');
  await expectNoAccessibilityViolations(page);
  await chooseTheme(page, 'dark');
  await expectNoAccessibilityViolations(page);
});

test('the content health page shows admins what people could not find', async ({
  page,
}) => {
  test.skip(
    siteConfiguration.insights?.enabled !== true,
    'The project does not record what is asked.',
  );
  const section = page.getByRole('region', {
    name: 'What people could not find',
  });

  // Unanswered, as for anyone but an admin, the section is not there, once
  // the page has asked and been refused.
  const asked = page.waitForResponse('**/_kb/insights.json');
  await page.goto('/content-health/');
  await asked;
  await expect(section).toBeHidden();

  // The Worker answers an admin; the static server does not, so it is here.
  const markup = '<img src=x onerror="document.title=1">';
  await page.route('**/_kb/insights.json', (route) =>
    route.fulfill({
      json: {
        report: {
          week: '2026-10-05',
          notFound: [
            {
              label: 'parking permit',
              count: 4,
              site: 1,
              queries: [
                { query: 'parking permit', count: 3 },
                { query: markup, count: 1 },
              ],
              clients: [{ client: 'Claude', count: 3 }],
              documents: [{ id: 'abcdef', count: 2 }],
            },
          ],
          foundNotRead: [{ id: 'abcdef', appearances: 12, fetches: 0 }],
          use: {
            notFound: {
              mcp: { searches: 40, notFound: 6, share: 0.15 },
              site: { searches: 0, notFound: 0, share: null },
            },
          },
        },
        documents: { abcdef: { title: 'Parking', url: '/d/abcdef/' } },
      },
    }),
  );
  await page.goto('/content-health/');
  await expect(section).toBeVisible();
  await expect(section).toContainText(
    'assistants found nothing good for 6 of 40 searches (15%)',
  );
  await expect(section.locator('q').first()).toHaveText('parking permit');
  // What a reader typed is text, never markup.
  await expect(section).toContainText(markup);
  await expect(section.locator('img')).toHaveCount(0);
  await expect(
    section.getByRole('link', { name: 'Parking' }).first(),
  ).toHaveAttribute('href', '/d/abcdef/');
  await expect(section).toContainText('Returned 12×, read 0×');

  await chooseTheme(page, 'light');
  await expectNoAccessibilityViolations(page);
  await chooseTheme(page, 'dark');
  await expectNoAccessibilityViolations(page);
});

test('the report says when it is partial, and claims nothing of the rest', async ({
  page,
}) => {
  test.skip(
    siteConfiguration.insights?.enabled !== true,
    'The project does not record what is asked.',
  );
  await page.route('**/_kb/insights.json', (route) =>
    route.fulfill({
      json: {
        report: {
          week: '2026-10-05',
          records: { mcpCalls: 50_000, truncated: true, unreadable: 2 },
          notFound: [],
          foundNotRead: [],
          use: {
            notFound: {
              mcp: { searches: 30_000, notFound: 0, share: 0 },
              site: { searches: 0, notFound: 0, share: null },
            },
          },
        },
        documents: {},
      },
    }),
  );
  await page.goto('/content-health/');
  const section = page.getByRole('region', {
    name: 'What people could not find',
  });
  await expect(section).toContainText('these are the first of them');
  await expect(section).toContainText('2 records could not be read');
  await expect(section).not.toContainText('Nothing asked went unfound');
  await expectNoAccessibilityViolations(page);
});

test('a settled site search is reported once, with the result opened', async ({
  page,
}) => {
  test.skip(
    siteConfiguration.insights?.enabled !== true ||
      siteConfiguration.insights.siteSearch === false,
    'The project does not record site searches.',
  );
  const reports: unknown[] = [];
  await page.route('**/_kb/insights/search', async (route) => {
    reports.push(JSON.parse(route.request().postData() ?? 'null'));
    await route.fulfill({ status: 204 });
  });
  const { title } = anyDocument();
  const openSearch = () =>
    page
      .locator('header')
      .getByRole('button', { name: 'Search', exact: true })
      .click();
  const box = page.getByPlaceholder('Search');
  const first = page.locator('.pagefind-ui__result a').first();
  await page.goto('/');

  // A search closed with Escape before it settles is none: Escape also
  // clears Pagefind's box without a keystroke. Nothing is sent of it.
  await openSearch();
  await box.fill(title);
  await expect(first).toBeVisible();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1_700);
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pagehide')),
  );
  expect(reports).toEqual([]);

  // Settled, but not sent until what follows it is known.
  await openSearch();
  await box.fill(title);
  await expect(first).toBeVisible();
  await page.waitForTimeout(1_700);
  expect(reports).toEqual([]);

  const href = new URL(
    (await first.getAttribute('href')) ?? '/',
    'https://site.invalid',
  ).pathname;
  const sent = page.waitForRequest('**/_kb/insights/search');
  await first.click();
  await sent;
  await expect.poll(() => reports.length).toBe(1);
  expect(reports[0]).toMatchObject({ query: title, opened: href });
  expect((reports[0] as { results: number }).results).toBeGreaterThan(0);
});

test('a PDF has a page with the file and its text', async ({
  page,
  request,
}) => {
  const sample = pdfDocument();
  test.skip(!sample, 'The corpus has no PDF files.');
  const { document, fileUrl } = sample as NonNullable<typeof sample>;

  await page.goto(`/${document.slug}/`);
  await expect(
    page.getByRole('heading', { level: 1, name: document.title }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Open in Google Drive' }),
  ).toHaveAttribute('href', /^https:\/\/drive\.google\.com\/file\/d\//u);
  if (fileUrl) {
    await expect(
      page.getByRole('link', { name: 'Open the PDF' }),
    ).toHaveAttribute('href', fileUrl);
    const file = await request.get(fileUrl);
    expect(file.ok()).toBe(true);
    expect(file.headers()['content-type']).toMatch(/^application\/pdf/u);
  }
  await expectNoAccessibilityViolations(page);
});

test('a spreadsheet has a page whose long tables filter and sort', async ({
  page,
}) => {
  const sheets = sheetDocuments();
  test.skip(sheets.length === 0, 'The corpus has no spreadsheets.');
  // A real corpus has spreadsheets of thousands of rows; each is opened once.
  test.setTimeout(30_000 + sheets.length * 5_000);

  /*
   * The spreadsheet whose page holds the fewest table rows among those with a
   * table long enough to filter, so the audit below reads a page of a size a
   * browser test can.
   */
  let chosen: { slug: string; rows: number } | undefined;
  for (const sheet of sheets) {
    await page.goto(`/${sheet.slug}/`);
    await expect(
      page.getByRole('heading', { level: 1, name: sheet.title }),
    ).toBeVisible();
    // A Google Sheet opens in Google Sheets, an uploaded file in Drive.
    const source = page.getByRole('link', {
      name: /^Open in Google (?:Sheets|Drive)$/u,
    });
    await expect(source).toBeVisible();
    const native = (await source.getAttribute('href'))?.startsWith(
      'https://docs.google.com/spreadsheets/',
    );
    await expect(source).toHaveText(
      native ? 'Open in Google Sheets' : 'Open in Google Drive',
    );
    if ((await page.locator('.kb-sheet-tall').count()) === 0) {
      continue;
    }
    const rows = await page.locator('.sl-markdown-content tr').count();
    if (!chosen || rows < chosen.rows) {
      chosen = { slug: sheet.slug, rows };
    }
  }
  test.skip(!chosen, 'No spreadsheet has a table long enough to filter.');
  await page.goto(`/${chosen?.slug ?? ''}/`);

  const wrapper = page.locator('.kb-sheet-tall').first();
  const rows = wrapper.locator('tbody tr');
  const total = await rows.count();
  const filter = page.getByRole('searchbox', { name: 'Filter rows' }).first();
  const status = page.locator('.kb-sheet-count').first();

  await filter.fill('no row says this 7d1f');
  await expect(rows.filter({ visible: true })).toHaveCount(0);
  await expect(status).toHaveText(`0 of ${total} rows`);
  await filter.fill('');
  await expect(rows.filter({ visible: true })).toHaveCount(total);

  const header = wrapper.locator('thead th').first();
  const sort = header.getByRole('button');
  await sort.click();
  await expect(header).toHaveAttribute('aria-sort', 'ascending');
  await sort.click();
  await expect(header).toHaveAttribute('aria-sort', 'descending');

  // The header stays in view while the table scrolls.
  await wrapper.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(header).toBeInViewport();

  /*
   * Every row of a table is the same markup, so the first fifty stand for
   * all: the rest leave the page before the audit, which over thousands of
   * rows outlasts the test.
   */
  await page.evaluate(() => {
    for (const row of document.querySelectorAll(
      '.sl-markdown-content tbody tr:nth-child(n+51)',
    )) {
      row.remove();
    }
  });
  await expectNoAccessibilityViolations(page);
});

test("a recording plays in Drive's player, with a link to where it plays", async ({
  page,
}) => {
  const recordings = mediaDocuments();
  test.skip(recordings.length === 0, 'The corpus has no video or audio.');
  /*
   * Drive's player is Google's page, not the site's: the suite stands in a
   * blank one, so it neither reaches Google nor audits what it shows.
   */
  await page.route('https://drive.google.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>Player</title>' }),
  );

  for (const recording of recordings) {
    await page.goto(`/${recording.slug}/`);
    await expect(
      page.getByRole('heading', { level: 1, name: recording.title }),
    ).toBeVisible();
    const verb = recording.format === 'audio' ? 'Listen' : 'Watch';
    const action = page.getByRole('link', {
      name: new RegExp(`^${verb} in Google (?:Drive|Vids)$`, 'u'),
    });
    await expect(action).toHaveAttribute(
      'href',
      /^https:\/\/(?:drive\.google\.com\/file\/d\/|docs\.google\.com\/videos\/d\/)/u,
    );
    const vids = (await action.getAttribute('href'))?.startsWith(
      'https://docs.google.com/videos/',
    );
    // The row under the title keeps its link to the source, as on every page.
    await expect(
      page.getByRole('link', { name: /^Open in Google (?:Drive|Vids)$/u }),
    ).toBeVisible();
    // The site hosts no recording: an uploaded one plays in Drive's player,
    // and Google Vids has none to frame.
    await expect(page.locator('video, audio')).toHaveCount(0);
    const player = page.locator('iframe.media-player');
    if (vids) {
      await expect(player).toHaveCount(0);
    } else {
      await expect(player).toHaveAttribute(
        'src',
        /^https:\/\/drive\.google\.com\/file\/d\/[^/]+\/preview$/u,
      );
      await expect(player).toHaveAttribute('title', recording.title);
    }
    await expect(
      page.getByText(/plays in Google (?:Drive|Vids)\.$/u).first(),
    ).toBeVisible();
  }
  await expectNoAccessibilityViolations(page);
});

test('the home page shows the folders in the order the sidebar does', async ({
  page,
}) => {
  await page.goto('/');
  const cards = (await page.locator('.category-name').allInnerTexts()).map(
    (text) => text.trim(),
  );
  test.skip(cards.length < 2, 'The corpus has one folder to show.');

  await page.goto(`/${anyDocument().slug}/`);
  const sidebar = (
    await page.locator('#starlight__sidebar details > summary').allInnerTexts()
  ).map((text) => text.trim());

  expect(cards).toEqual(sidebar.filter((label) => cards.includes(label)));
});

test('the sidebar marks a page that is not a Google Doc with an icon of its format', async ({
  page,
}) => {
  const marked = [
    ...sheetDocuments().slice(0, 1),
    ...mediaDocuments().slice(0, 1),
  ];
  test.skip(marked.length === 0, 'The corpus has only Google Docs.');

  for (const document of marked) {
    await page.goto(`/${document.slug}/`);
    const link = page.locator(
      `#starlight__sidebar a[href="/${document.slug}/"]`,
    );
    const icon = link.locator('.kb-format');
    await expect(icon).toHaveCount(1);
    // The format's name is announced, not shown: the icon stands in for it.
    await expect(icon).toHaveText(
      DOCUMENT_FORMAT_BADGES[document.format ?? 'google-doc'] ?? '',
    );
    const box = await icon.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(0);
    expect(box?.width ?? 99).toBeLessThan(24);
    // It is drawn in its format's own color, not the row's gray.
    const [iconColor, linkColor] = await Promise.all([
      icon.evaluate((element) => getComputedStyle(element).backgroundColor),
      link.evaluate((element) => getComputedStyle(element).color),
    ]);
    expect(iconColor).not.toBe(linkColor);
    expect(iconColor).not.toBe('rgba(0, 0, 0, 0)');
  }
  await expectNoAccessibilityViolations(page);

  // The full index draws the same tile before the title, not a page outline.
  await page.goto(PLATFORM_ROUTE_HREFS.fullIndex);
  for (const document of marked) {
    const row = page.locator(`a[href="/${document.slug}/"]`).filter({
      hasText: document.title,
    });
    await expect(
      row.first().locator(`.kb-format-${document.format ?? 'google-doc'}`),
    ).toHaveCount(1);
  }
});

test('the header shows the mark the project configures, for the theme chosen on the site', async ({
  page,
}) => {
  const { faviconPath, faviconDarkPath } = siteConfiguration.brand;
  // The mark the header shows, after the reader chose a theme on the site.
  const shown = async (theme: 'light' | 'dark') => {
    await page.addInitScript((value) => {
      localStorage.setItem('starlight-theme', value);
    }, theme);
    await page.goto('/');
    const visible = page.locator('.site-title img').filter({ visible: true });
    await expect(visible).toHaveCount(1);
    const size = await visible.evaluate((image: HTMLImageElement) => ({
      natural: image.naturalWidth,
      width: image.getBoundingClientRect().width,
    }));
    // The file loaded, and it keeps its own shape at the header's height.
    expect(size.natural).toBeGreaterThan(0);
    expect(size.width).toBeGreaterThan(0);
    return visible.getAttribute('src');
  };

  // The site's choice wins over the system's, either way round.
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await shown('light')).toBe(faviconPath);
  await page.emulateMedia({ colorScheme: 'light' });
  expect(await shown('dark')).toBe(faviconDarkPath ?? faviconPath);

  // The tab follows the browser: the dark mark only under a dark interface.
  const darkIcon = page.locator('link[rel="icon"][media]');
  if (faviconDarkPath) {
    await expect(darkIcon).toHaveAttribute('href', faviconDarkPath);
    await expect(darkIcon).toHaveAttribute(
      'media',
      '(prefers-color-scheme: dark)',
    );
  } else {
    await expect(darkIcon).toHaveCount(0);
  }
});

test('the sidebar opens only the folders that hold the current page', async ({
  page,
}) => {
  const document = deepestDocument();
  await page.goto(`/${document.slug}/`);
  const current = page.locator('#starlight__sidebar a[aria-current="page"]');
  await expect(current).toBeVisible();
  // Every folder that does not hold the page starts closed.
  const states = await page
    .locator('#starlight__sidebar details')
    .evaluateAll((elements) =>
      elements
        .filter((element) => element.querySelector('a[href]') !== null)
        .filter(
          (element) =>
            !element.querySelector('a[aria-current="page"]') &&
            // The navigation section the platform adds above the corpus.
            !element.querySelector(':scope > ul > li > a[href="/"]'),
        )
        .map((element) => (element as HTMLDetailsElement).open),
    );
  expect(states.length).toBeGreaterThan(0);
  expect(states.every((open) => !open)).toBe(true);
});

test('a reader can hide the sidebar and the choice holds across pages', async ({
  page,
}) => {
  const document = anyDocument();
  await page.goto(`/${document.slug}/`);
  const sidebar = page.locator('#starlight__sidebar');
  const toggle = page.getByRole('button', { name: 'Hide sidebar' });
  await expect(sidebar).toBeVisible();
  const before = await page.locator('main').boundingBox();

  await toggle.click();
  await expect(sidebar).toBeHidden();
  const show = page.getByRole('button', { name: 'Show sidebar' });
  await expect(show).toHaveAttribute('aria-controls', 'starlight__sidebar');
  const after = await page.locator('main').boundingBox();
  // The content takes the room the sidebar left.
  expect(after?.x ?? 0).toBeLessThan(before?.x ?? 0);
  await expectNoAccessibilityViolations(page, ['.header']);

  await page.reload();
  await expect(sidebar).toBeHidden();
  await page.getByRole('button', { name: 'Show sidebar' }).click();
  await expect(sidebar).toBeVisible();
  await page.reload();
  await expect(sidebar).toBeVisible();

  // On a phone the sidebar is Starlight's menu and the button is not drawn;
  // a stored choice to hide it does not empty the menu.
  await page.getByRole('button', { name: 'Hide sidebar' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator('.kb-sidebar-toggle')).toBeHidden();
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(sidebar.locator('a[aria-current="page"]')).toBeVisible();
});

test('a shown sidebar comes back scrolled to the current page', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 320 });
  await page.goto(`/${deepestDocument().slug}/`);
  await page.getByRole('button', { name: 'Hide sidebar' }).click();
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  const sidebar = page.locator('#starlight__sidebar');
  const scrollable = await page.evaluate(() => {
    document.documentElement.removeAttribute('data-kb-sidebar');
    const pane = document.getElementById('starlight__sidebar');
    const tall = pane ? pane.scrollHeight > pane.clientHeight : false;
    document.documentElement.dataset.kbSidebar = 'hidden';
    return tall;
  });
  test.skip(!scrollable, 'The sidebar fits the screen.');
  await page.getByRole('button', { name: 'Show sidebar' }).click();
  await expect(sidebar.locator('a[aria-current="page"]')).toBeInViewport({
    ratio: 1,
  });
});

test('the sidebar opens scrolled to the current page', async ({ page }) => {
  const document = deepestDocument();
  // A short screen, so the sidebar is taller than its pane.
  await page.setViewportSize({ width: 1280, height: 320 });
  await page.goto(`/${document.slug}/`);
  const sidebar = page.locator('#starlight__sidebar');
  const scrollable = await sidebar.evaluate(
    (element) => element.scrollHeight > element.clientHeight,
  );
  test.skip(!scrollable, 'The sidebar fits the screen.');
  await expect(sidebar.locator('a[aria-current="page"]')).toBeInViewport({
    ratio: 1,
  });
});

test('the contents list keeps the heading being read in view', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 320 });
  await page.goto(`/${documentWithMostHeadings().slug}/`);
  const tall = await page
    .locator('.right-sidebar')
    .evaluate((element) => element.scrollHeight > element.clientHeight * 1.5)
    .catch(() => false);
  test.skip(!tall, 'No contents list is taller than the screen.');
  // Bring the last section's heading to where Starlight marks it as read.
  await page.evaluate(() => {
    const headings = document.querySelectorAll<HTMLElement>(
      '.sl-markdown-content h2[id], .sl-markdown-content h3[id]',
    );
    const last = headings[headings.length - 1];
    const header = document.querySelector('header')?.offsetHeight ?? 0;
    if (last) {
      window.scrollTo(
        0,
        last.getBoundingClientRect().top + window.scrollY - header - 48,
      );
    }
  });
  const current = page.locator('.right-sidebar a[aria-current="true"]:visible');
  await expect(current).toHaveCount(1);
  await expect(current).toBeInViewport({ ratio: 1 });
});

test('a screenshot drawn smaller than its file opens full size', async ({
  page,
}) => {
  const withAsset = documentWithAsset();
  if (!withAsset) {
    test.skip(true, 'The corpus has no image.');
    return;
  }
  // The corpus images are tiny swatches: serve a wide one in their place.
  await page.route(/\.(png|jpe?g|webp|gif)(\?|$)|\/_image\?/u, (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#888"/></svg>',
    }),
  );
  await page.goto(`/${withAsset.document.slug}/`);
  const zoom = page.locator('.sl-markdown-content .kb-zoom').first();
  await expect(zoom).toBeVisible();
  await expect(zoom).toHaveAccessibleName(/^Enlarge image/u);
  await expectNoAccessibilityViolations(page, ['.kb-zoom']);

  await zoom.click();
  const dialog = page.locator('dialog.kb-zoom-dialog');
  await expect(dialog).toBeVisible();
  // Centred on the screen, not pinned to a corner by a margin reset.
  const box = await dialog.boundingBox();
  const width = page.viewportSize()?.width ?? 0;
  expect(Math.abs((box?.x ?? 0) * 2 + (box?.width ?? 0) - width)).toBeLessThan(
    4,
  );
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await zoom.click();
  await dialog.click();
  await expect(dialog).toBeHidden();
});

test('a long page offers a way back to the top', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 320 });
  await page.goto(`/${documentWithMostHeadings().slug}/`);
  const button = page.getByRole('button', { name: 'Back to top' });
  await expect(button).toBeHidden();
  const long = await page.evaluate(
    () => document.documentElement.scrollHeight > window.innerHeight * 3,
  );
  test.skip(!long, 'The page is too short.');
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
  await expect(button).toBeVisible();
  await expectNoAccessibilityViolations(page, ['.kb-back-to-top']);
  await button.click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(button).toBeHidden();
  // Keyboard focus goes back to the page's title.
  await expect(page.locator('#_top')).toBeFocused();

  // On a phone the open menu covers the button and keeps focus to itself.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
  await expect(button).toBeVisible();
  await page.getByRole('button', { name: 'Menu' }).click();
  const box = await button.boundingBox();
  const onTop = await page.evaluate(
    ([x, y]) =>
      document.elementFromPoint(x ?? 0, y ?? 0)?.closest('.kb-back-to-top') !==
      null,
    [(box?.x ?? 0) + 5, (box?.y ?? 0) + 5],
  );
  expect(onTop).toBe(false);
  expect(
    await button.evaluate((element) => element.closest('[inert]') !== null),
  ).toBe(true);
});

test('the sidebar filter keeps the documents whose title or folder matches', async ({
  page,
}) => {
  const document = deepestDocument();
  await page.goto(`/${document.slug}/`);
  const sidebar = page.locator('#starlight__sidebar');
  const field = page.getByRole('searchbox', { name: 'Filter sidebar' });
  const openBefore = await sidebar
    .locator('details')
    .evaluateAll((elements) =>
      elements.map((element) => (element as HTMLDetailsElement).open),
    );

  // `/` reaches the field from the page.
  await page.locator('main').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('/');
  await expect(field).toBeFocused();

  // A word of the document's title and one of its folder's name.
  const title = await sidebar
    .locator('a[aria-current="page"] > span')
    .innerText();
  const titleWord =
    title.split(/\s+/u).find((word) => /^\p{L}{4,}$/u.test(word)) ?? title;
  const folder = document.folderPath?.at(-1) ?? '';
  const folderWord =
    folder.split(/\s+/u).find((word) => /^\p{L}{3,}$/u.test(word)) ?? '';
  await field.fill(`${folderWord} ${titleWord}`.trim());

  const visible = sidebar.locator('a[href]:visible');
  await expect(visible.first()).toBeVisible();
  const count = await visible.count();
  const total = await sidebar.locator('a[href]').count();
  expect(count).toBeLessThan(total);
  await expect(sidebar.locator('a[aria-current="page"]')).toBeVisible();
  const statusLine = page.locator('#kb-sidebar-filter-status');
  await expect(statusLine).toHaveText(
    `${count} ${count === 1 ? 'document' : 'documents'}`,
  );
  await expectNoAccessibilityViolations(page, ['#starlight__sidebar']);

  await field.fill('zzzz-nothing-has-this-title');
  await expect(visible).toHaveCount(0);
  await expect(statusLine).toHaveText('No document matches.');

  // Escape clears the field and puts every folder back as it was.
  await page.keyboard.press('Escape');
  await expect(field).toHaveValue('');
  await expect(sidebar.locator('li[hidden]')).toHaveCount(0);
  const openAfter = await sidebar
    .locator('details')
    .evaluateAll((elements) =>
      elements.map((element) => (element as HTMLDetailsElement).open),
    );
  expect(openAfter).toEqual(openBefore);

  // Enter opens the first match: here a document other than this one.
  const otherTitle = await sidebar.evaluate(
    (element) =>
      [
        ...element.querySelectorAll(
          'a[href]:not([aria-current]) > span:first-child',
        ),
      ]
        .map((span) => span.textContent?.trim() ?? '')
        .filter((text) => text.length > 0)
        .at(-1) ?? '',
  );
  expect(otherTitle).not.toBe('');
  await field.fill(otherTitle);
  const first = await visible.first().getAttribute('href');
  const here = new URL(page.url()).pathname;
  expect(first).not.toBe(here);
  await page.keyboard.press('Enter');
  await page.waitForURL((url) => url.pathname === first);
});

test('the sidebar filter leaves the phone menu and the slash key alone', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/${deepestDocument().slug}/`);
  const menu = page.getByRole('button', { name: 'Menu' });

  // With the menu closed, `/` is the browser's again.
  const taken = await page.evaluate(() => {
    const event = new KeyboardEvent('keydown', {
      key: '/',
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(taken).toBe(false);

  // In the open menu, Escape clears the field and the menu stays open.
  await menu.click();
  const field = page.getByRole('searchbox', { name: 'Filter sidebar' });
  await field.fill('a');
  await field.press('Escape');
  await expect(field).toHaveValue('');
  // Starlight marks an open menu on the body.
  const body = page.locator('body');
  await expect(body).toHaveAttribute('data-mobile-menu-expanded', '');
  // A second Escape, on an empty field, closes the menu as Starlight does.
  await field.press('Escape');
  await expect(body).not.toHaveAttribute('data-mobile-menu-expanded');
});

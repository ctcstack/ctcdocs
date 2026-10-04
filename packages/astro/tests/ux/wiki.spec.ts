import { AxeBuilder } from '@axe-core/playwright';
import { ACCESS_CLASSES_ROUTE } from '@ctcstack/ctcdocs-core';
import { expect, test, type Page } from '@playwright/test';
import type { Root, RootContent } from 'mdast';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

import {
  folderAnchorId,
  folderTrail,
  normalizeFolderName,
} from '../../lib/folder-anchor.js';
import { siteConfiguration } from '../../lib/project.js';
import {
  anyDocument,
  contentHealthReport,
  deepestDocument,
  folderAccessFindingCount,
  searchBundlesOfEveryClass,
  unpublishedReport,
  documentInFolder,
  documentLinkingAnother,
  documentWithAsset,
  documentWithPermanentLink,
  documentWithTable,
  folderPages,
  pdfDocument,
  sectionWithSubfolder,
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

async function expectNoAccessibilityViolations(page: Page): Promise<void> {
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
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
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
    await remInPixels(page, 0.5),
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

  const theme = page.getByRole('combobox', { name: 'Select theme' });
  await theme.selectOption({ label: 'Light' });
  await expectNoAccessibilityViolations(page);
  await theme.selectOption({ label: 'Dark' });
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

test('a private deployment offers Sign out as a form the Worker accepts', async ({
  page,
}) => {
  test.skip(
    siteConfiguration.deployment.environments.production.visibility !==
      'private',
    'A public deployment has no session to end.',
  );
  await page.goto('/');
  const form = page.locator('header form.sign-out');
  await expect(form).toHaveAttribute('method', 'post');
  await expect(form).toHaveAttribute('action', '/auth/sign-out');
  await expect(form.getByRole('button', { name: 'Sign out' })).toBeVisible();
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
  const theme = page.getByRole('combobox', { name: 'Select theme' });
  await theme.selectOption({ label: 'Light' });
  await expectNoAccessibilityViolations(page);
  await theme.selectOption({ label: 'Dark' });
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

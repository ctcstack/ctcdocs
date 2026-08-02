/**
 * The Astro configuration a CTCDocs project deploys.
 *
 * A project's `astro.config.mjs` is a call to `ctcdocsConfig`. Everything the
 * reader interface needs — the Markdown processor, the Starlight setup, the
 * component overrides, the injected routes — is constructed here, so a fix
 * reaches every deployment with a version bump rather than N edits.
 *
 * The Markdown processor is built here rather than handed to Starlight as a
 * plugin list on purpose: Starlight appends Expressive Code as its own
 * integration after plugin setup, and `remarkMermaid` has to claim mermaid
 * fences before Expressive Code turns them into a code frame. Constructing the
 * processor at this level is what keeps that order.
 */
import { unified } from '@astrojs/markdown-remark';
import starlight from '@astrojs/starlight';
import type { StarlightUserConfig } from '@astrojs/starlight/types';
import { parseSiteConfiguration } from '@ctcstack/ctcdocs-core';
import type { AstroUserConfig } from 'astro';

import { normalizeFolderName } from './lib/folder-anchor.js';
import { remarkMermaid } from './lib/remark-mermaid.js';
import { remarkTableScroll } from './lib/remark-table-scroll.js';
import { ctcdocsRoutes } from './route-injection.js';

type SidebarConfiguration = NonNullable<StarlightUserConfig['sidebar']>;

export interface CtcdocsConfigOptions {
  /** The project's `site.config.json`, parsed and validated here. */
  siteConfig: unknown;
  /** The generated sidebar, imported by the project from `src/generated/`. */
  sidebar: SidebarConfiguration;
  /** The generated redirect map, imported by the project the same way. */
  redirects: Record<string, string>;
  /**
   * Rendered above the generated tree: where a project links the pages it
   * writes by hand. Defaults to a "Documentation" group holding only the home
   * link, because the home page is a route rather than a collection entry.
   */
  sidebarPrefix?: SidebarConfiguration;
  /** Merged over the generated Starlight configuration. Use sparingly. */
  starlight?: Partial<StarlightUserConfig>;
  /** Merged over the generated Astro configuration. Use sparingly. */
  astro?: Partial<AstroUserConfig>;
}

/**
 * Drive folder names reach the generated sidebar with their trailing slash
 * ("Company/"), while breadcrumbs render the same folder as "Company". The
 * generated file is owned by the sync pipeline and must not be edited, so the
 * label is normalized here, at the point of use.
 */
function normalizeSidebarLabels(
  items: SidebarConfiguration,
): SidebarConfiguration {
  return items.map((item) =>
    typeof item === 'object' && item !== null && 'items' in item
      ? {
          ...item,
          label: normalizeFolderName(String(item.label)),
          items: normalizeSidebarLabels(item.items as SidebarConfiguration),
        }
      : item,
  ) as SidebarConfiguration;
}

export function ctcdocsConfig(options: CtcdocsConfigOptions): AstroUserConfig {
  const site = parseSiteConfiguration(options.siteConfig);
  const { brand, deployment } = site;

  const sidebarPrefix: SidebarConfiguration = options.sidebarPrefix ?? [
    {
      // A navigation section, not the product: the wordmark in the header
      // already names the site, so this label stays generic.
      label: 'Documentation',
      items: [{ label: 'Home', link: '/' }],
    },
  ];

  const starlightConfiguration: StarlightUserConfig = {
    title: brand.siteTitle,
    description: brand.siteDescription,
    favicon: brand.faviconPath,
    // Brand tokens first: the interface stylesheet builds on the accent and
    // mark defined there, so a project restyles the site by replacing
    // brand.css alone.
    customCss: ['./src/styles/brand.css', '@ctcstack/ctcdocs/styles.css'],
    /*
     * Only what differs from Starlight's own Expressive Code defaults, which
     * already resolve to the site's monospace family at 0.875rem. The frame
     * takes the reference's geometry — a hairline box at the page radius on
     * the sunken ground — and code sets tighter than prose, because 1.75
     * leading on a fixed-width face reads as a list rather than a block.
     *
     * The syntax themes are deliberately not overridden. Naming a `themes`
     * pair here makes Starlight emit one Expressive Code stylesheet and link a
     * different hash, so every page loads a 404 and code renders unstyled.
     * Starlight's own pair derives from the color tokens above, so the code
     * palette already follows this theme rather than importing one.
     */
    expressiveCode: {
      styleOverrides: {
        borderColor: 'var(--sl-color-hairline)',
        borderRadius: '0.5rem',
        codeBackground: 'var(--kb-surface-sunken)',
        codeLineHeight: '1.625',
        frames: {
          editorTabBarBackground: 'transparent',
          editorTabBarBorderBottomColor: 'var(--sl-color-hairline)',
          editorActiveTabBackground: 'transparent',
          editorActiveTabBorderColor: 'transparent',
          editorActiveTabIndicatorTopColor: 'transparent',
          editorActiveTabForeground: 'var(--sl-color-white)',
          terminalBackground: 'var(--kb-surface-sunken)',
          terminalTitlebarBackground: 'transparent',
          terminalTitlebarBorderBottomColor: 'var(--sl-color-hairline)',
          terminalTitlebarForeground: 'var(--sl-color-gray-3)',
          frameBoxShadowCssValue: 'none',
        },
      },
    },
    components: {
      // Source provenance moved from the footer to under the title.
      EditLink: '@ctcstack/ctcdocs/components/NoEditLink.astro',
      Head: '@ctcstack/ctcdocs/components/Head.astro',
      PageTitle: '@ctcstack/ctcdocs/components/DocumentHeader.astro',
      // Carets rather than arrows on the previous and next links.
      Pagination: '@ctcstack/ctcdocs/components/Pagination.astro',
      SiteTitle: '@ctcstack/ctcdocs/components/SiteTitle.astro',
      SkipLink: '@ctcstack/ctcdocs/components/SkipLink.astro',
    },
    // Source provenance is reported under the title from googleModifiedTime,
    // which is when a person edited the document. Starlight's footer stamp
    // would repeat it from the sync commit, which is a different, less
    // meaningful date.
    lastUpdated: false,
    pagination: true,
    sidebar: [...sidebarPrefix, ...normalizeSidebarLabels(options.sidebar)],
    head: [
      {
        tag: 'meta',
        attrs: {
          name: 'robots',
          content: 'noindex, nofollow, noarchive',
        },
      },
    ],
    ...options.starlight,
  };

  return {
    site: deployment.environments.production.url,
    output: 'static',
    prefetch: {
      prefetchAll: true,
      defaultStrategy: 'tap',
    },
    redirects: options.redirects,
    markdown: {
      /*
       * Two transforms the reader interface needs and Markdown has no node
       * for: mermaid fences are claimed before Expressive Code turns them into
       * a code frame, and every table gains its own scroll container.
       *
       * The processor is named explicitly because Astro 7 deprecates the bare
       * `markdown.remarkPlugins` array. `unified()` keeps the defaults this
       * site relies on — GitHub-Flavored Markdown and SmartyPants — and both
       * Starlight and Expressive Code append their own transforms to it, so
       * the plugins here run first without displacing theirs.
       */
      processor: unified({
        remarkPlugins: [remarkMermaid, remarkTableScroll],
      }),
    },
    integrations: [ctcdocsRoutes(), starlight(starlightConfiguration)],
    ...options.astro,
  };
}

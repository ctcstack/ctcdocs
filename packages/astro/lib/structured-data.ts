/**
 * Structured data for a page's head: what the page is, in schema.org terms.
 *
 * An agent that fetches a page as HTML finds here, without parsing the
 * interface, what the page is called, when a person last edited its source,
 * where that source is, and where its Markdown version is served. It is the
 * machine-readable twin of the provenance row under a document's title.
 *
 * Only three kinds of page describe themselves: the home page as the site, a
 * synchronized document, and a section page. The platform's own routes — the
 * full index, content health, 404 — are not content and carry nothing.
 *
 * See docs/ADR/033-publish-llms-txt-indexes.md.
 */
import { oneLine } from './text.js';

export type StructuredPage =
  | { kind: 'home' }
  | {
      kind: 'document';
      title: string;
      description: string | undefined;
      /** When a person last edited the source, never when it was synced. */
      modified: string | undefined;
      sourceUrl: string | undefined;
      markdownPath: string;
    }
  | { kind: 'section'; title: string };

export interface StructuredDataContext {
  siteName: string;
  siteDescription: string | undefined;
  /** The site's root URL, absolute. */
  siteUrl: string;
  /** This page's canonical URL, absolute. */
  pageUrl: string;
}

/*
 * The JSON is written into a script element, where `</script>` or `<!--` in a
 * title would end or corrupt it. Escaping the characters that can start markup
 * keeps the JSON equal to what was serialized.
 */
function scriptSafe(json: string): string {
  return json
    .replace(/</gu, '\\u003c')
    .replace(/>/gu, '\\u003e')
    .replace(/&/gu, '\\u0026')
    .replace(/\u2028/gu, '\\u2028')
    .replace(/\u2029/gu, '\\u2029');
}

/** The serialized JSON-LD for a page, safe to place in a script element. */
export function structuredData(
  page: StructuredPage,
  context: StructuredDataContext,
): string {
  const website = {
    '@type': 'WebSite',
    name: context.siteName,
    url: context.siteUrl,
  };
  const description =
    page.kind === 'home'
      ? oneLine(context.siteDescription)
      : page.kind === 'document'
        ? oneLine(page.description)
        : undefined;

  let data: Record<string, unknown>;
  switch (page.kind) {
    case 'home':
      data = {
        '@context': 'https://schema.org',
        ...website,
        ...(description ? { description } : {}),
      };
      break;
    case 'document':
      data = {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: page.title,
        ...(description ? { description } : {}),
        url: context.pageUrl,
        ...(page.modified ? { dateModified: page.modified } : {}),
        ...(page.sourceUrl ? { isBasedOn: page.sourceUrl } : {}),
        encoding: {
          '@type': 'MediaObject',
          encodingFormat: 'text/markdown',
          contentUrl: new URL(page.markdownPath, context.siteUrl).href,
        },
        isPartOf: website,
      };
      break;
    case 'section':
      data = {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: page.title,
        url: context.pageUrl,
        isPartOf: website,
      };
      break;
  }

  return scriptSafe(JSON.stringify(data));
}

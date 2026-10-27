import type { Root } from 'mdast';
import * as cheerio from 'cheerio';

import { unwrapGoogleRedirect } from '../conversion/url-policy.js';
import {
  parseGoogleDocumentLink,
  permanentLinkShortId,
  processor,
  siteAddress,
  walk,
} from './rewrite-internal-links.js';

/**
 * What one link in a document points at, as the corpus can tell:
 *
 * - `google`: a Google file by its Drive ID, which the site did not publish
 *   when the document was written, so the link still leads to Google;
 * - `permanent`: an item the site published, by its short ID (ADR-022);
 * - `address`: a path on the site that named no item when the document was
 *   written.
 *
 * Every other link leads outside the corpus and depends on nothing in it.
 */
export type DocumentLink =
  | { kind: 'google'; fileId: string }
  | { kind: 'permanent'; shortId: string }
  | { kind: 'address'; path: string };

function linkOf(
  value: string,
  siteOrigins: readonly string[],
): DocumentLink | undefined {
  const target = unwrapGoogleRedirect(value) ?? value;
  const google = parseGoogleDocumentLink(target);
  if (google) {
    return { kind: 'google', fileId: google.fileId };
  }
  const address = siteAddress(target, siteOrigins);
  if (!address) {
    return undefined;
  }
  const shortId = permanentLinkShortId(address.path);
  return shortId
    ? { kind: 'permanent', shortId }
    : { kind: 'address', path: address.path };
}

function keyOf(link: DocumentLink): string {
  switch (link.kind) {
    case 'google':
      return `google:${link.fileId}`;
    case 'permanent':
      return `permanent:${link.shortId}`;
    case 'address':
      return `address:${link.path}`;
  }
}

/**
 * The links a generated document's body holds, each once, in a stable order.
 * The body is read the way the sync wrote its links: Markdown links and the
 * anchors of embedded HTML.
 */
export function documentLinks(
  body: string,
  siteOrigins: readonly string[],
): DocumentLink[] {
  const links = new Map<string, DocumentLink>();
  const add = (value: string) => {
    const link = linkOf(value, siteOrigins);
    if (link) {
      links.set(keyOf(link), link);
    }
  };
  walk(processor.parse(body) as Root, (node) => {
    if (node.type === 'link') {
      add(node.url);
    } else if (node.type === 'html') {
      const $ = cheerio.load(node.value, null, false);
      $('a[href]').each((_, anchor) => {
        const href = $(anchor).attr('href');
        if (href) {
          add(href);
        }
      });
    }
  });
  return [...links]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, link]) => link);
}

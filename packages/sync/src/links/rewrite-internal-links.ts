import type { Link, Root, RootContent } from 'mdast';
import * as cheerio from 'cheerio';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';

import { permanentLinkPath, PLATFORM_ROUTES } from '@ctcstack/ctcdocs-core';

import { unwrapGoogleRedirect } from '../conversion/url-policy.js';

const GOOGLE_FILE_ID = /^[A-Za-z0-9_-]+$/u;
const READABLE_ANCHOR = /^[\p{L}\p{N}][\p{L}\p{N}_.:-]*$/u;
const GOOGLE_SPECIFIC_ANCHOR = /^(?:bookmark=id\.|heading=h\.)/u;

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkStringify, {
    bullet: '-',
    emphasis: '*',
    fences: true,
    listItemIndent: 'one',
    strong: '*',
  });

export interface InternalLinkRewrite {
  body: string;
  warnings: string[];
}

/**
 * What a link inside the corpus can point at, keyed the two ways a link names
 * its target. A link is written as the target's permanent link (ADR-022), so
 * the document that holds it never changes when the target is renamed or
 * moved; the site resolves it to the current address when it builds.
 */
export interface InternalLinkTargets {
  /** Drive ID of every published document and folder to its short ID. */
  shortIds: ReadonlyMap<string, string>;
  /**
   * Every address the site answers for an item, current or redirected, to
   * that item's Drive ID. An editor who pastes a page's address rather than
   * its Google Doc gets the same permanent link.
   */
  addressOwners: ReadonlyMap<string, string>;
  /** Origins the site is served from, for pasted absolute addresses. */
  siteOrigins: readonly string[];
}

interface GoogleDocumentLink {
  fileId: string;
  fragment: string;
}

function parseGoogleDocumentLink(
  value: string,
): GoogleDocumentLink | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }

  let fileId: string | null = null;
  if (url.hostname === 'docs.google.com') {
    const match = /^\/document\/d\/([^/]+)\/(?:edit|view)\/?$/u.exec(
      url.pathname,
    );
    fileId = match?.[1] ?? null;
  } else if (
    url.hostname === 'drive.google.com' &&
    url.pathname.replace(/\/+$/u, '') === '/open'
  ) {
    fileId = url.searchParams.get('id');
  }
  if (!fileId || !GOOGLE_FILE_ID.test(fileId)) {
    return undefined;
  }

  return { fileId, fragment: url.hash };
}

function safeFragment(fragment: string): {
  fragment: string;
  removed: boolean;
} {
  if (!fragment) {
    return { fragment: '', removed: false };
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(fragment.slice(1));
  } catch {
    return { fragment: '', removed: true };
  }
  if (GOOGLE_SPECIFIC_ANCHOR.test(decoded)) {
    return { fragment: '', removed: true };
  }
  return READABLE_ANCHOR.test(decoded)
    ? { fragment, removed: false }
    : { fragment: '', removed: true };
}

const PERMANENT_LINK = new RegExp(
  `^${PLATFORM_ROUTES.permanentLinks}/([0-9a-f]{6,64})$`,
  'u',
);

/**
 * The item a site address names, when the address is this site's: a
 * root-relative path, or an absolute URL on one of the site's origins.
 */
function siteLinkTarget(
  value: string,
  targets: InternalLinkTargets,
): { shortId: string; fragment: string } | undefined {
  if (value.startsWith('//')) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(value, 'https://relative.invalid');
  } catch {
    return undefined;
  }
  if (
    url.origin !== 'https://relative.invalid' &&
    !targets.siteOrigins.includes(url.origin)
  ) {
    return undefined;
  }
  if (url.origin === 'https://relative.invalid' && !value.startsWith('/')) {
    return undefined;
  }
  let path: string;
  try {
    path = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/gu, '');
  } catch {
    return undefined;
  }
  const permanent = PERMANENT_LINK.exec(path)?.[1];
  const knownShortIds = new Set(targets.shortIds.values());
  if (permanent && knownShortIds.has(permanent)) {
    return { shortId: permanent, fragment: url.hash };
  }
  const owner = targets.addressOwners.get(path);
  const shortId = owner ? targets.shortIds.get(owner) : undefined;
  return shortId ? { shortId, fragment: url.hash } : undefined;
}

function rewriteUrl(
  value: string,
  targets: InternalLinkTargets,
): { url: string; removedFragment: boolean } | undefined {
  /*
   * A Google redirect is unwrapped before anything else is decided about the
   * link. It is what makes a wrapped link between two documents in this corpus
   * recognizable as one, and what keeps an unchanged document from producing a
   * diff on every full export.
   */
  const unwrapped = unwrapGoogleRedirect(value);
  const target = unwrapped ?? value;

  const googleLink = parseGoogleDocumentLink(target);
  const shortId = googleLink
    ? targets.shortIds.get(googleLink.fileId)
    : undefined;
  if (googleLink && shortId) {
    const fragment = safeFragment(googleLink.fragment);
    return {
      url: `${permanentLinkPath(shortId)}${fragment.fragment}`,
      removedFragment: fragment.removed,
    };
  }

  const siteLink = siteLinkTarget(target, targets);
  if (siteLink) {
    return {
      url: `${permanentLinkPath(siteLink.shortId)}${siteLink.fragment}`,
      removedFragment: false,
    };
  }

  // Everything else keeps pointing where it pointed — at the real address
  // rather than through Google.
  return unwrapped ? { url: unwrapped, removedFragment: false } : undefined;
}

function walk(
  node: Root | RootContent,
  visit: (node: RootContent) => void,
): void {
  if (node.type !== 'root') {
    visit(node);
  }
  if ('children' in node) {
    for (const child of node.children) {
      walk(child, visit);
    }
  }
}

export function rewriteInternalGoogleLinks(
  body: string,
  targets: InternalLinkTargets,
): InternalLinkRewrite {
  const tree = processor.parse(body) as Root;
  const warnings = new Set<string>();
  walk(tree, (node) => {
    if (node.type === 'link') {
      const rewritten = rewriteUrl(node.url, targets);
      if (rewritten) {
        (node as Link).url = rewritten.url;
        if (rewritten.removedFragment) {
          warnings.add('link:removed_google_anchor');
        }
      }
    } else if (node.type === 'html') {
      const $ = cheerio.load(node.value, null, false);
      let changed = false;
      $('a[href]').each((_, anchor) => {
        const href = $(anchor).attr('href');
        const rewritten = href ? rewriteUrl(href, targets) : undefined;
        if (!rewritten) {
          return;
        }
        $(anchor).attr('href', rewritten.url);
        changed = true;
        if (rewritten.removedFragment) {
          warnings.add('link:removed_google_anchor');
        }
      });
      if (changed) {
        node.value = $.root().html() ?? '';
      }
    }
  });

  const rewritten = processor.stringify(tree).trimEnd();
  return {
    body: rewritten ? `${rewritten}\n` : '',
    warnings: [...warnings].sort(),
  };
}

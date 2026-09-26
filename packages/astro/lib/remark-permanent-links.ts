import type { Root, RootContent } from 'mdast';
import { PLATFORM_ROUTES } from '@ctcstack/ctcdocs-core';

/**
 * Renders a permanent link as the address it currently leads to.
 *
 * The sync writes a link between two documents as the target's permanent
 * link, `/d/<short ID>/`, so the document holding it never changes when the
 * target is renamed or moved (ADR-022). The redirect map says where each one
 * leads today. Resolving it here, while the site builds, sends a reader
 * straight to the page instead of through a redirect page on every click.
 *
 * A permanent link the map does not know is left as it is: it is either a
 * hand-written link to nothing, which the sync already refuses for generated
 * pages, or one a later build will know.
 */
export function resolvePermanentLink(
  value: string,
  redirects: Readonly<Record<string, string>>,
): string | undefined {
  const prefix = `/${PLATFORM_ROUTES.permanentLinks}/`;
  if (!value.startsWith(prefix)) {
    return undefined;
  }
  const suffixStart = value.search(/[?#]/u);
  const path = suffixStart < 0 ? value : value.slice(0, suffixStart);
  const suffix = suffixStart < 0 ? '' : value.slice(suffixStart);
  const target = redirects[path.endsWith('/') ? path : `${path}/`];
  return target === undefined ? undefined : `${target}${suffix}`;
}

const HREF_ATTRIBUTE = /(\shref\s*=\s*)(["'])([^"']*)\2/giu;

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

export function remarkPermanentLinks(
  redirects: Readonly<Record<string, string>>,
) {
  return () => (tree: Root) => {
    walk(tree, (node) => {
      if (node.type === 'link' || node.type === 'definition') {
        node.url = resolvePermanentLink(node.url, redirects) ?? node.url;
        return;
      }
      if (node.type !== 'html') {
        return;
      }
      /*
       * Inline HTML reaches this tree in pieces: `<a href="…">` is one node
       * and `</a>` another. Re-serializing a piece through an HTML parser
       * would close the element early, so only the attribute value changes.
       */
      node.value = node.value.replace(
        HREF_ATTRIBUTE,
        (attribute, prefix: string, quote: string, href: string) => {
          const resolved = resolvePermanentLink(href, redirects);
          return resolved === undefined
            ? attribute
            : `${prefix}${quote}${resolved}${quote}`;
        },
      );
    });
  };
}

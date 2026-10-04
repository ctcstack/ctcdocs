import type { Root, RootContent } from 'mdast';
import { resolvePermanentLink } from '@ctcstack/ctcdocs-core';

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

import type { Root, RootContent } from 'mdast';

/*
 * An opening `<a …>` tag in inline HTML. Its attributes are read from the tag
 * itself: inline HTML reaches the tree in pieces, `<a href="…">` in one node
 * and `</a>` in another, so the element cannot be parsed whole.
 */
const OPENING_ANCHOR = /<a\b[^>]*>/giu;
const HREF_ATTRIBUTE = /\shref\s*=\s*(["'])([^"']*)\1/iu;
const TARGET_ATTRIBUTE = /\starget\s*=/iu;
const REL_ATTRIBUTE = /\srel\s*=/iu;

const NEW_TAB = { target: '_blank', rel: ['noopener', 'noreferrer'] };

/** What `mdast-util-to-hast` reads from a node; mdast does not declare it. */
interface HastData {
  hProperties?: Record<string, unknown>;
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

/**
 * Whether a link leaves the site: an absolute web address on a host that is
 * not one of the site's own. A relative link, an anchor, `mailto:` and `tel:`
 * stay where the reader is.
 */
export function isExternalHref(
  href: string,
  siteHostnames: ReadonlySet<string>,
): boolean {
  let url: URL;
  try {
    url = new URL(href.startsWith('//') ? `https:${href}` : href);
  } catch {
    return false;
  }
  return (
    (url.protocol === 'https:' || url.protocol === 'http:') &&
    !siteHostnames.has(url.hostname.toLowerCase())
  );
}

/**
 * Opens every link that leaves the site in a new tab, so a reader following a
 * reference out of a document keeps the document open. Markdown has no syntax
 * for it, so Markdown links and references gain the attributes through
 * `hProperties`, and an `<a>` written as inline HTML gains them in its tag
 * unless it names its own target.
 */
export function remarkExternalLinks(siteHostnames: Iterable<string>) {
  const hostnames = new Set(
    [...siteHostnames].map((hostname) => hostname.toLowerCase()),
  );
  return () => (tree: Root) => {
    const definitions = new Map<string, string>();
    walk(tree, (node) => {
      if (node.type === 'definition') {
        definitions.set(node.identifier, node.url);
      }
    });
    walk(tree, (node) => {
      if (node.type === 'link' || node.type === 'linkReference') {
        const href =
          node.type === 'link' ? node.url : definitions.get(node.identifier);
        if (href !== undefined && isExternalHref(href, hostnames)) {
          const data = (node.data ?? {}) as HastData;
          node.data = {
            ...data,
            hProperties: { ...data.hProperties, ...NEW_TAB },
          } as typeof node.data;
        }
        return;
      }
      if (node.type !== 'html') {
        return;
      }
      node.value = node.value.replace(OPENING_ANCHOR, (tag) => {
        const href = HREF_ATTRIBUTE.exec(tag)?.[2];
        if (
          href === undefined ||
          TARGET_ATTRIBUTE.test(tag) ||
          !isExternalHref(href, hostnames)
        ) {
          return tag;
        }
        const rel = REL_ATTRIBUTE.test(tag) ? '' : ' rel="noopener noreferrer"';
        return tag.replace(/\s*(\/?)>$/u, ` target="_blank"${rel}$1>`);
      });
    });
  };
}

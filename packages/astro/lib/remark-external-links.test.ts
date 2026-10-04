import type { Root, RootContent } from 'mdast';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { describe, expect, it } from 'vitest';

import {
  isExternalHref,
  remarkExternalLinks,
} from './remark-external-links.js';

const site = new Set(['docs.example.test']);

function transform(markdown: string): Root {
  const processor = unified().use(remarkParse).use(remarkExternalLinks(site));
  return processor.runSync(processor.parse(markdown)) as Root;
}

function nodes(tree: Root, type: RootContent['type']): RootContent[] {
  const found: RootContent[] = [];
  const visit = (node: Root | RootContent) => {
    if (node.type === type) {
      found.push(node as RootContent);
    }
    if ('children' in node) {
      node.children.forEach(visit);
    }
  };
  visit(tree);
  return found;
}

function hProperties(node: RootContent): unknown {
  return (node.data as { hProperties?: unknown } | undefined)?.hProperties;
}

const NEW_TAB = { target: '_blank', rel: ['noopener', 'noreferrer'] };

describe('links that leave the site', () => {
  it('tells an outside address from the site and from other schemes', () => {
    expect(isExternalHref('https://example.org/page', site)).toBe(true);
    expect(isExternalHref('http://example.org', site)).toBe(true);
    expect(isExternalHref('//example.org/page', site)).toBe(true);
    expect(isExternalHref('https://DOCS.example.test/a/', site)).toBe(false);
    expect(isExternalHref('/sales/pricing/', site)).toBe(false);
    expect(isExternalHref('#rates', site)).toBe(false);
    expect(isExternalHref('mailto:team@example.org', site)).toBe(false);
    expect(isExternalHref('tel:+100', site)).toBe(false);
  });

  it('opens Markdown links and references in a new tab', () => {
    const tree = transform(
      [
        '[Outside](https://example.org/page)',
        '<https://example.org/auto>',
        '[Reference][outside]',
        '[outside]: https://example.org/ref',
      ].join('\n\n'),
    );

    const links = [...nodes(tree, 'link'), ...nodes(tree, 'linkReference')];
    expect(links).toHaveLength(3);
    for (const link of links) {
      expect(hProperties(link)).toEqual(NEW_TAB);
    }
  });

  it('leaves links within the site in the same tab', () => {
    const tree = transform(
      [
        '[Pricing](/sales/pricing/)',
        '[Absolute](https://docs.example.test/sales/)',
        '[Mail](mailto:team@example.org)',
        '[Missing][nowhere]',
      ].join('\n\n'),
    );

    for (const link of [
      ...nodes(tree, 'link'),
      ...nodes(tree, 'linkReference'),
    ]) {
      expect(hProperties(link)).toBeUndefined();
    }
  });

  it('opens an inline HTML anchor in a new tab unless it names a target', () => {
    const tree = transform(
      [
        '<a href="https://example.org/a">A</a>',
        '<a href="https://example.org/b" rel="nofollow">B</a>',
        '<a href="https://example.org/c" target="_self">C</a>',
        '<a href="/inside/">D</a>',
      ].join('\n\n'),
    );

    const html = nodes(tree, 'html')
      .map((node) => (node as { value: string }).value)
      .join('\n');
    expect(html).toContain(
      '<a href="https://example.org/a" target="_blank" rel="noopener noreferrer">',
    );
    expect(html).toContain(
      '<a href="https://example.org/b" rel="nofollow" target="_blank">',
    );
    expect(html).toContain('<a href="https://example.org/c" target="_self">');
    expect(html).toContain('<a href="/inside/">');
  });
});

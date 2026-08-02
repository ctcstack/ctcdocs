import type { Root } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { describe, expect, it } from 'vitest';

import { remarkTableScroll } from './remark-table-scroll.js';

function transform(markdown: string): Root {
  const tree = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .parse(markdown) as Root;
  remarkTableScroll()(tree);
  return tree;
}

function values(tree: Root): string[] {
  return tree.children.map((node) =>
    node.type === 'html' ? node.value : node.type,
  );
}

describe('Table scroll wrapper', () => {
  it('wraps a Markdown table', () => {
    const tree = transform('| a | b |\n| - | - |\n| 1 | 2 |\n');

    expect(values(tree)).toEqual(['<div class="kb-table">', 'table', '</div>']);
  });

  it('wraps a table that survived the HTML fallback', () => {
    const tree = transform(
      '<table><tbody><tr><td colspan="2">Merged</td></tr></tbody></table>\n',
    );

    expect(values(tree)).toEqual([
      '<div class="kb-table"><table><tbody><tr><td colspan="2">Merged</td></tr></tbody></table></div>',
    ]);
  });

  it('wraps a nested table only at its outermost level', () => {
    const tree = transform(
      '<table><tbody><tr><td><table><tbody><tr><td>inner</td></tr></tbody></table></td></tr></tbody></table>\n',
    );
    const [wrapped] = values(tree);

    expect(wrapped?.startsWith('<div class="kb-table"><table>')).toBe(true);
    expect(wrapped?.match(/kb-table/gu)).toHaveLength(1);
  });

  it('leaves HTML without a table untouched', () => {
    const tree = transform('<p>Plain paragraph</p>\n');

    expect(values(tree)).toEqual(['<p>Plain paragraph</p>']);
  });
});

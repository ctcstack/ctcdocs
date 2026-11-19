import type { Root } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { describe, expect, it } from 'vitest';

import { remarkEmptyHeadings } from './remark-empty-headings.js';

function transform(markdown: string): Root {
  const tree = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .parse(markdown) as Root;
  remarkEmptyHeadings()(tree);
  return tree;
}

function kinds(tree: Root): string[] {
  return tree.children.map((node) =>
    node.type === 'heading' ? `h${node.depth}` : node.type,
  );
}

describe('Empty headings', () => {
  it('drops a heading with no text', () => {
    const tree = transform('Intro\n\n##\n\n### \n\nBody\n');

    expect(kinds(tree)).toEqual(['paragraph', 'paragraph']);
  });

  it('drops a heading that holds only white space', () => {
    const tree = transform('## \u00a0\n\n#### \t\n\nBody\n');

    expect(kinds(tree)).toEqual(['paragraph']);
  });

  it('keeps a heading with text, code or an image', () => {
    const tree = transform(
      '## Title\n\n## `code`\n\n## ![Logo](logo.png)\n\n## <img src="a.png" alt="A">\n',
    );

    expect(kinds(tree)).toEqual(['h2', 'h2', 'h2', 'h2']);
  });

  it('drops an empty heading inside a block quote or list', () => {
    const tree = transform('> ## \n> Quote\n\n- ##\n- Item\n');
    const quote = tree.children[0];
    const list = tree.children[1];

    expect(
      quote?.type === 'blockquote' && quote.children.map((node) => node.type),
    ).toEqual(['paragraph']);
    expect(
      list?.type === 'list' &&
        list.children[0]?.children.map((node) => node.type),
    ).toEqual([]);
  });
});

import type { Root, RootContent } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { describe, expect, it } from 'vitest';

import { createPdfFixture } from '../test-support/create-pdf-fixture.js';
import { looksLikePdf, pdfTextToMarkdown, readPdfText } from './read-pdf.js';

function parsed(markdown: string): { types: Set<string>; urls: string[] } {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  const types = new Set<string>();
  const urls: string[] = [];
  const visit = (node: Root | RootContent) => {
    types.add(node.type);
    if (node.type === 'link') {
      urls.push(node.url);
    }
    if ('children' in node) {
      for (const child of node.children) {
        visit(child);
      }
    }
  };
  visit(tree);
  return { types, urls };
}

describe('readPdfText', () => {
  it('reads the text of every page', async () => {
    const result = await readPdfText(
      createPdfFixture([['First page.', 'Second line.'], ['Second page.']]),
    );

    expect(result).toEqual({
      pageCount: 2,
      pages: ['First page.\nSecond line.', 'Second page.'],
    });
  });

  it('says a damaged file cannot be read, and quotes nothing from it', async () => {
    const bytes = createPdfFixture([['Private text.']]);
    const damaged = bytes.slice(0, 60);

    const result = await readPdfText(damaged);

    expect(result.pageCount).toBeNull();
    expect(result.pages).toEqual([]);
    expect(['damaged', 'unreadable']).toContain(result.unreadable);
  });
});

describe('looksLikePdf', () => {
  it('finds the header in the first kilobyte only', () => {
    expect(looksLikePdf(createPdfFixture([['x']]))).toBe(true);
    expect(looksLikePdf(new TextEncoder().encode('<html>%PDF-</html>'))).toBe(
      true,
    );
    expect(
      looksLikePdf(new TextEncoder().encode(`${' '.repeat(2048)}%PDF-1.4`)),
    ).toBe(false);
    expect(looksLikePdf(new TextEncoder().encode('PK\u0003\u0004'))).toBe(
      false,
    );
  });
});

describe('pdfTextToMarkdown', () => {
  it('turns lines into paragraphs under a heading per page', () => {
    const result = pdfTextToMarkdown(
      [
        'Handbook\nThe first sentence runs\nacross two lines.\n• A list item\n• Another',
        '',
        'Last page with a hyphen-\nated word.',
      ],
      'Handbook',
    );

    expect(result.body).toBe(
      [
        '## Page 1',
        '',
        'Handbook',
        '',
        'The first sentence runs across two lines.',
        '',
        '• A list item',
        '',
        '• Another',
        '',
        '## Page 3',
        '',
        // Kept: the sync cannot tell a broken word from a compound one.
        'Last page with a hyphen-ated word.',
        '',
      ].join('\n'),
    );
    // The title on its own line is not a description.
    expect(result.description).toBe(
      'The first sentence runs across two lines.',
    );
    expect(result).toMatchObject({ hasText: true, truncated: false });
  });

  it('writes one paragraph without a page heading for a single page', () => {
    const result = pdfTextToMarkdown(['Only page.'], 'Title');

    expect(result.body).toBe('Only page.\n');
  });

  it('reports a PDF with no text', () => {
    expect(pdfTextToMarkdown(['', ' \n '], 'Scan')).toEqual({
      body: '',
      hasText: false,
      truncated: false,
    });
  });

  it('leaves out text past the limit, and a page with none of its text', () => {
    const long = 'x'.repeat(1_000_001);

    expect(pdfTextToMarkdown([long, 'Second.'], 'Title')).toEqual({
      body: '',
      hasText: false,
      truncated: true,
    });
    expect(pdfTextToMarkdown(['First.', long], 'Title')).toMatchObject({
      body: '## Page 1\n\nFirst.\n',
      hasText: true,
      truncated: true,
    });
  });

  it('keeps text from becoming markup, links or HTML', () => {
    const hostile = [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '[click](javascript:alert(1))',
      '# Not a heading',
      '*not emphasis* and __not strong__',
      '| a | b |',
      '```',
      '> not a quote',
      '<!-- not a comment -->',
      '![image](https://example.invalid/x.png)',
    ].join('\n\n');

    const { body } = pdfTextToMarkdown([hostile], 'Title');
    const { types, urls } = parsed(body);

    // A bare web address stays a link, as GFM makes it; nothing else does.
    expect([...types].sort()).toEqual(['link', 'paragraph', 'root', 'text']);
    expect(urls).toEqual(['https://example.invalid/x.png']);
    expect(body).toContain('\\<script>');
  });
});

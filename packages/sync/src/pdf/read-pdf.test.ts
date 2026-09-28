import type { Root, RootContent } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { describe, expect, it } from 'vitest';

import { createPdfFixture } from '../test-support/create-pdf-fixture.js';
import {
  looksLikePdf,
  pdfTextToMarkdown,
  readPdfText,
  textFromItems,
  type PositionedText,
} from './read-pdf.js';

function piece(
  str: string,
  x: number,
  y: number,
  width = str.length * 6,
  hasEOL = false,
): PositionedText {
  return { str, x, y, width, fontSize: 12, hasEOL };
}

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

describe('textFromItems', () => {
  it('puts a space or a line break where the pieces sit apart', () => {
    expect(
      textFromItems([
        piece('Our process in brief.', 72, 700),
        // A label and its description, drawn as pieces of one row.
        piece('PLANNING', 72, 650, 80),
        piece('Scope, budget', 200, 650),
        // Kerning splits a word into pieces that touch.
        piece('Sched', 72, 636, 36),
        piece('ule', 108, 636),
      ]),
    ).toBe('Our process in brief.\n\nPLANNING Scope, budget\nSchedule');
  });

  it('keeps the breaks PDF.js reports and adds none twice', () => {
    expect(
      textFromItems([
        piece('First line', 72, 700, 60, true),
        piece('', 72, 686, 0, true),
        piece('Second line', 72, 686),
        piece(' and more', 138, 686),
      ]),
    ).toBe('First line\nSecond line and more');
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

  it('keeps each line in capitals apart, and never makes it the description', () => {
    const result = pdfTextToMarkdown(
      [
        'QUARTERLY PLAN\n2026 OUTLOOK\nThe old process no longer fits the team\nWHY WE ARE CHANGING\nWe see this clearly:',
      ],
      'Quarterly plan',
    );

    expect(result.body).toBe(
      [
        'QUARTERLY PLAN',
        '',
        '2026 OUTLOOK',
        '',
        'The old process no longer fits the team',
        '',
        'WHY WE ARE CHANGING',
        '',
        'We see this clearly:',
        '',
      ].join('\n'),
    );
    expect(result.description).toBe('We see this clearly:');
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

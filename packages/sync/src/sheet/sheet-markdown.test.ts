import type { Root, RootContent } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { describe, expect, it } from 'vitest';

import {
  createXlsxFixture,
  type XlsxFixture,
} from '../test-support/create-xlsx-fixture.js';
import { readDelimited } from './read-delimited.js';
import { readXlsx } from './read-xlsx.js';
import { workbookToMarkdown } from './sheet-markdown.js';

function page(fixture: XlsxFixture, title = 'Workbook') {
  return workbookToMarkdown(readXlsx(createXlsxFixture(fixture)), title);
}

function nodeTypes(markdown: string): { types: Set<string>; urls: string[] } {
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

const MODEL: XlsxFixture = {
  sheets: [
    {
      name: 'Plan',
      merges: ['A1:D1'],
      charts: 1,
      cells: {
        A1: 'Staffing plan',
        A2: 'Metric',
        B2: 'Jan',
        C2: 'Feb',
        D2: 'Mar',
        A3: 'Payroll',
        B3: { value: 5000, format: '"$"#,##0' },
        C3: { value: 6000, format: '"$"#,##0' },
        D3: { value: 7000, format: '"$"#,##0' },
        A4: 'Cost per agent',
        B4: { value: 25, format: '"$"#,##0.00' },
        C4: { value: 25, format: '"$"#,##0.00' },
        D4: { value: 30, format: '"$"#,##0.00' },
        A5: 'Agents',
        B5: {
          formula: 'B3/B4',
          value: 200,
          shared: { index: 0, ref: 'B5:D5' },
        },
        C5: { value: 240, shared: { index: 0 } },
        D5: { value: 233.33, shared: { index: 0 } },
        A6: 'Overtime share',
        B6: { value: 0.1, format: '0%' },
        A7: 'Overtime agents',
        B7: { formula: 'B5*$B$6', value: 20 },
        C7: { formula: 'C5*$B$6', value: 24 },
        D7: { formula: 'D5*$B$6', value: 23.3 },
        A9: 'Notes',
        A10: 'Prices exclude tax.',
        A12: 'Overtime agents in all',
        B12: { formula: 'SUM(B7:D7)', value: 67.3, format: '0.0' },
        A13: 'Guide',
        B13: { value: 'Open', link: 'https://example.com/guide' },
      },
    },
    { name: 'Hidden', hidden: true, cells: { A1: 'not for the site' } },
    {
      name: 'Prices',
      cells: {
        A1: 'Item',
        B1: 'Price',
        A2: 'Basic',
        B2: 10,
        A3: 'Pro',
        B3: 20,
      },
    },
  ],
  names: { OvertimeRate: 'Plan!$B$6' },
};

describe('workbookToMarkdown', () => {
  it('publishes each visible sheet with its tables and calculations', () => {
    const result = page(MODEL);
    expect(result.body).toBe(
      [
        '## Plan',
        '',
        '### Staffing plan',
        '',
        '| Metric | Jan | Feb | Mar |',
        '| - | -: | -: | -: |',
        '| Payroll | $5,000 | $6,000 | $7,000 |',
        '| Cost per agent | $25.00 | $25.00 | $30.00 |',
        '| Agents | 200 | 240 | 233.33 |',
        '| Overtime share | 10% | | |',
        '| Overtime agents | 20 | 24 | 23.3 |',
        '',
        '### Notes',
        '',
        'Prices exclude tax.',
        '',
        '- **Overtime agents in all:** 67.3',
        '- **Guide:** [Open](https://example.com/guide)',
        '',
        '### How it is calculated',
        '',
        '**Formulas**',
        '',
        '- **Agents** (`B5:D5`): `=B3/B4`, where `B3` is Payroll and `B4` is Cost per agent',
        '- **Overtime agents** (`B7:D7`): `=B5*$B$6`, where `B5` is Agents and `$B$6` is OvertimeRate',
        '- **Overtime agents in all** (`B12`): `=SUM(B7:D7)`, where `B7:D7` is Overtime agents',
        '',
        '**Inputs**',
        '',
        '- **Payroll, Jan** (`B3`): $5,000',
        '- **Payroll, Feb** (`C3`): $6,000',
        '- **Payroll, Mar** (`D3`): $7,000',
        '- **Cost per agent, Jan** (`B4`): $25.00',
        '- **Cost per agent, Feb** (`C4`): $25.00',
        '- **Cost per agent, Mar** (`D4`): $30.00',
        '- **OvertimeRate** (`B6`): 10%',
        '',
        '**Results**',
        '',
        '- **Overtime agents in all** (`B12`): 67.3',
        '',
        '*This sheet has 1 chart the site does not show. Open the spreadsheet to see it.*',
        '',
        '## Prices',
        '',
        '| Item | Price |',
        '| - | -: |',
        '| Basic | 10 |',
        '| Pro | 20 |',
        '',
      ].join('\n'),
    );
    expect(result).toMatchObject({
      description: 'A spreadsheet with the sheets Plan and Prices.',
      sheets: 2,
      formulas: 7,
      warnings: ['sheet:charts'],
    });
    expect(result.body).not.toContain('not for the site');
  });

  it('writes the same page twice', () => {
    expect(page(MODEL).body).toBe(page(MODEL).body);
  });

  it('heads a lone sheet with nothing and describes it by its columns', () => {
    const result = page({
      sheets: [
        {
          name: 'Sheet1',
          cells: { A1: 'Name', B1: 'Team', A2: 'Ada', B2: 'Ops' },
        },
      ],
    });
    expect(result.body).toBe('| Name | Team |\n| - | - |\n| Ada | Ops |\n');
    expect(result.description).toBe(
      'A spreadsheet with the columns Name and Team.',
    );
  });

  it('heads a lone sheet’s sections one level below the title', () => {
    const result = page({
      sheets: [
        {
          name: 'Only',
          cells: {
            A1: 'Totals',
            A2: 'a',
            B2: 'b',
            A3: 1,
            B3: { formula: 'A3*2', value: 2 },
          },
        },
      ],
    });
    expect(result.body).toContain('## Totals\n');
    expect(result.body).toContain('## How it is calculated\n');
    expect(result.body).not.toContain('###');
  });

  it('repeats a merged value in every cell of a table it covers', () => {
    const result = page({
      sheets: [
        {
          name: 'Merged',
          merges: ['A2:A3'],
          cells: {
            A1: 'Region',
            B1: 'Month',
            A2: 'North',
            B2: 'Jan',
            B3: 'Feb',
          },
        },
      ],
    });
    expect(result.body).toContain('| North | Jan |\n| North | Feb |');
  });

  it('keeps every character of a cell as text', () => {
    const result = page({
      sheets: [
        {
          name: 'Hostile',
          cells: {
            A1: 'Name',
            B1: 'Value',
            A2: '<script>alert(1)</script>',
            B2: '[click](javascript:alert(1))',
            A3: '# not a heading',
            B3: '| pipe |',
          },
        },
      ],
    });
    const { types, urls } = nodeTypes(result.body);
    expect(types.has('html')).toBe(false);
    expect(types.has('heading')).toBe(false);
    expect(urls).toEqual([]);
  });

  it('says where a sheet stops and what it does not show', () => {
    const workbook = readDelimited(
      new TextEncoder().encode('a,b\n1,2'),
      'data',
      false,
    );
    const sheet = workbook.sheets[0];
    if (!sheet) {
      throw new Error('No sheet.');
    }
    sheet.truncatedAfterRow = 2;
    sheet.images = 2;
    const result = workbookToMarkdown(workbook, 'Data');
    expect(result.body).toContain(
      '*The site shows this sheet up to row 2. Open the spreadsheet for the rest.*',
    );
    expect(result.body).toContain(
      '*This sheet has 2 images the site does not show.',
    );
    expect(result.warnings).toEqual(['sheet:images', 'sheet:truncated']);
  });

  it('notes chart sheets and sheets past the limit', () => {
    const workbook = readXlsx(
      createXlsxFixture({
        sheets: [
          { name: 'Data', cells: { A1: 1 } },
          { name: 'Chart', chartSheet: true },
        ],
      }),
    );
    const result = workbookToMarkdown(
      { ...workbook, omittedSheets: 3 },
      'Data',
    );
    expect(result.body).toContain(
      '*The spreadsheet also has 1 chart on a sheet of its own and 3 more sheets, which the site does not show.*',
    );
    expect(result.warnings).toEqual(['sheet:charts', 'sheet:truncated']);
  });

  it('names a formula by its column when it fills a column', () => {
    const result = page({
      sheets: [
        {
          name: 'Orders',
          cells: {
            A1: 'Item',
            B1: 'Price',
            C1: 'Quantity',
            D1: 'Total',
            A2: 'Tea',
            B2: 2,
            C2: 3,
            D2: { formula: 'B2*C2', value: 6 },
            A3: 'Cake',
            B3: 4,
            C3: 1,
            D3: { formula: 'B3*C3', value: 4 },
          },
        },
      ],
    });
    expect(result.body).toContain(
      '- **Total** (`D2:D3`): `=B2*C2`, where `B2` is Price and `C2` is Quantity',
    );
    // Nothing uses the totals, so they are one result, not one per row.
    expect(result.body).toContain(
      '- **Total** (`D2:D3`): one for each row, in the table above',
    );
  });

  it('says which cells a defined name in a formula stands for', () => {
    const result = page({
      sheets: [
        {
          name: 'Tax',
          cells: {
            A1: 'Price',
            B1: 100,
            A2: 'Rate',
            B2: 0.2,
            A3: 'Tax',
            B3: { formula: 'B1*TaxRate', value: 20 },
          },
        },
      ],
      names: { TaxRate: 'Tax!$B$2' },
    });
    expect(result.body).toContain(
      '- **Tax** (`B3`): `=B1*TaxRate`, where `B1` is Price and `TaxRate` is B2',
    );
    expect(result.body).toContain('- **TaxRate** (`B2`): 0.2');
  });

  it('leaves out a caption that repeats the title', () => {
    const result = page(
      {
        sheets: [
          {
            name: 'Only',
            cells: { A1: 'Budget', A2: 'Item', B2: 'Cost', A3: 'Ads', B3: 1 },
          },
        ],
      },
      'budget',
    );
    expect(result.body.startsWith('| Item | Cost |')).toBe(true);
  });

  it('does not name a range that moves with its formula by its first row', () => {
    const result = page({
      sheets: [
        {
          name: 'Sums',
          cells: {
            A1: 'Team',
            B1: 'Q1',
            C1: 'Q2',
            D1: 'Year',
            A2: 'North',
            B2: 1,
            C2: 2,
            D2: { formula: 'SUM(B2:C2)', value: 3 },
            A3: 'South',
            B3: 3,
            C3: 4,
            D3: { formula: 'SUM(B3:C3)', value: 7 },
          },
        },
      ],
    });
    expect(result.body).toContain('- **Year** (`D2:D3`): `=SUM(B2:C2)`\n');
  });

  it('writes a column of single values as a list, however long', () => {
    const short = page({
      sheets: [
        {
          name: 'Keywords',
          cells: { A1: 'Keywords', A2: 'alpha', A3: 'beta', A4: 'gamma' },
        },
      ],
    });
    expect(short.body).toBe('- Keywords\n- alpha\n- beta\n- gamma\n');

    const cells = Object.fromEntries(
      Array.from({ length: 2000 }, (_, row) => [`A${row + 1}`, `word ${row}`]),
    );
    const long = page({ sheets: [{ name: 'Words', cells }] });
    expect(
      long.body.split('\n').filter((line) => line.startsWith('- ')),
    ).toHaveLength(2000);
    expect(long.body).not.toContain('#');
  });

  it('takes a caption only above a row of a table', () => {
    const result = page({
      sheets: [
        {
          name: 'Notes',
          cells: { A1: 'Owners', A2: 'Ada', A3: 'Grace', B3: 'Ops' },
        },
      ],
    });
    expect(result.body).not.toContain('## Owners');
  });

  it('describes an empty spreadsheet with nothing', () => {
    const result = page({ sheets: [{ name: 'Empty' }] });
    expect(result.body).toBe('');
    expect(result.description).toBeUndefined();
  });

  it('keeps a whole-row merge as wide as the cells beside it', () => {
    const result = page({
      sheets: [
        {
          name: 'Wide',
          merges: ['A1:XFD1'],
          cells: { A1: 'Title', A2: 'a', B2: 'b', A3: 1, B3: 2 },
        },
      ],
    });
    expect(result.body).toBe('## Title\n\n| a | b |\n| -: | -: |\n| 1 | 2 |\n');
  });

  it('never names a hidden sheet a formula refers to', () => {
    const result = page({
      sheets: [
        {
          name: 'Shown',
          cells: {
            A1: 'Pay',
            B1: { formula: "'Salaries 2026'!B5*1.2", value: 12 },
          },
        },
        { name: 'Salaries 2026', hidden: true, cells: { B5: 10 } },
      ],
      names: { Base: "'Salaries 2026'!$B$5" },
    });
    expect(result.body).toContain('`=[hidden sheet]!B5*1.2`');
    expect(result.body).not.toContain('Salaries');
  });

  it('finds a defined name only where a formula uses it as one', () => {
    const result = page({
      sheets: [
        {
          name: 'Rate',
          cells: {
            A1: 'Rate',
            B1: 0.2,
            A2: 'Card',
            B2: { formula: 'IF(A1="Rate card",1,0)', value: 0 },
            A3: 'Same sheet',
            B3: { formula: 'Rate!B1*2', value: 0.4 },
          },
        },
      ],
      names: { Rate: 'Rate!$B$1' },
    });
    expect(result.body).not.toContain('`Rate` is');
    expect(result.body).toContain('`Rate!B1` is Rate');
  });
});

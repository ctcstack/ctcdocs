import { describe, expect, it } from 'vitest';

import { UnsafeAssetError } from '../assets/validate-asset.js';
import { createStoredZipFixture } from '../test-support/create-zip-fixture.js';
import { createXlsxFixture } from '../test-support/create-xlsx-fixture.js';
import { formatNumber, readXlsx } from './read-xlsx.js';
import { MAX_SHEET_ROWS } from './workbook.js';

function texts(bytes: Uint8Array, sheet = 0): Record<string, string> {
  const workbook = readXlsx(bytes);
  return Object.fromEntries(
    (workbook.sheets[sheet]?.cells ?? []).map((cell) => [
      `${cell.row},${cell.column}`,
      cell.text,
    ]),
  );
}

describe('readXlsx', () => {
  it('shows each value as its number format does', () => {
    const bytes = createXlsxFixture({
      sheets: [
        {
          name: 'Values',
          cells: {
            A1: 'Text',
            B1: { value: 1234.5, format: '#,##0.00' },
            C1: { value: 0.153, format: '0%' },
            D1: { value: 5000, format: '"$"#,##0' },
            E1: { value: 45_000, format: 'yyyy-mm-dd' },
            F1: true,
            G1: { error: '#DIV/0!', formula: '1/0' },
            H1: 0.1 + 0.2,
          },
        },
      ],
    });
    expect(texts(bytes)).toEqual({
      '0,0': 'Text',
      '0,1': '1,234.50',
      '0,2': '15%',
      '0,3': '$5,000',
      '0,4': '2023-03-15',
      '0,5': 'TRUE',
      '0,6': '#DIV/0!',
      '0,7': '0.3',
    });
  });

  it('counts dates from 1904 when the workbook does', () => {
    const bytes = createXlsxFixture({
      date1904: true,
      sheets: [
        {
          name: 'Dates',
          cells: { A1: { value: 43_538, format: 'yyyy-mm-dd' } },
        },
      ],
    });
    expect(texts(bytes)).toEqual({ '0,0': '2023-03-15' });
  });

  it('formats with General where a format cannot show the value', () => {
    expect(formatNumber(12, 'not[[a format', false)).toBe('12');
    expect(formatNumber(1e300, 'yyyy-mm-dd', false)).toBe('1E+300');
  });

  it('leaves out hidden sheets and sheets that are only a chart', () => {
    const workbook = readXlsx(
      createXlsxFixture({
        sheets: [
          { name: 'Shown', cells: { A1: 'a' } },
          { name: 'Hidden', hidden: true, cells: { A1: 'secret' } },
          { name: 'Chart', chartSheet: true },
        ],
      }),
    );
    expect(workbook.sheets.map((sheet) => sheet.name)).toEqual(['Shown']);
    expect(workbook.hiddenSheets).toBe(1);
    expect(workbook.chartSheets).toBe(1);
    expect(JSON.stringify(workbook)).not.toContain('secret');
  });

  it('fills in a formula shared across a range', () => {
    const workbook = readXlsx(
      createXlsxFixture({
        sheets: [
          {
            name: 'Plan',
            cells: {
              B3: 1,
              C3: 2,
              B5: {
                formula: 'B3*2',
                value: 2,
                shared: { index: 0, ref: 'B5:C5' },
              },
              C5: { value: 4, shared: { index: 0 } },
            },
          },
        ],
      }),
    );
    expect(
      workbook.sheets[0]?.cells
        .filter((cell) => cell.formula !== undefined)
        .map((cell) => cell.formula),
    ).toEqual(['B3*2', 'C3*2']);
  });

  it('keeps links a page may carry and drops the rest', () => {
    const workbook = readXlsx(
      createXlsxFixture({
        sheets: [
          {
            name: 'Links',
            cells: {
              A1: { value: 'Guide', link: 'https://example.com/guide' },
              A2: { value: 'Run', link: 'javascript:alert(1)' },
              A3: { value: 'Mail', link: 'mailto:team@example.com' },
            },
          },
        ],
      }),
    );
    expect(workbook.sheets[0]?.cells.map((cell) => cell.link)).toEqual([
      'https://example.com/guide',
      undefined,
      'mailto:team@example.com',
    ]);
  });

  it('counts the charts and pictures drawn on a sheet', () => {
    const workbook = readXlsx(
      createXlsxFixture({
        sheets: [{ name: 'Drawn', cells: { A1: 1 }, charts: 2, images: 1 }],
      }),
    );
    expect(workbook.sheets[0]).toMatchObject({ charts: 2, images: 1 });
  });

  it('reads defined names that point at one range', () => {
    const workbook = readXlsx(
      createXlsxFixture({
        sheets: [{ name: "Plan 'A'", cells: { B2: 1 } }],
        names: { Rate: "'Plan ''A'''!$B$2", Broken: '#REF!' },
      }),
    );
    expect(workbook.names).toEqual([
      {
        name: 'Rate',
        sheet: "Plan 'A'",
        range: { top: 1, left: 1, bottom: 1, right: 1 },
      },
    ]);
  });

  it('cuts a sheet after the most rows a page publishes', () => {
    const cells = Object.fromEntries(
      Array.from({ length: MAX_SHEET_ROWS + 5 }, (_, row) => [
        `A${row + 1}`,
        row,
      ]),
    );
    const sheet = readXlsx(
      createXlsxFixture({ sheets: [{ name: 'Long', cells }] }),
    ).sheets[0];
    expect(sheet?.cells).toHaveLength(MAX_SHEET_ROWS);
    expect(sheet?.truncatedAfterRow).toBe(MAX_SHEET_ROWS);
  });

  it('refuses what is not a workbook, naming no content', () => {
    expect(() => readXlsx(new TextEncoder().encode('a,b\n1,2'))).toThrow(
      UnsafeAssetError,
    );
    expect(() =>
      readXlsx(
        createStoredZipFixture([{ path: '../escape.xml', bytes: '<x/>' }]),
      ),
    ).toThrow(UnsafeAssetError);
    expect(() =>
      readXlsx(createStoredZipFixture([{ path: 'other.txt', bytes: 'x' }])),
    ).toThrow(/no list of sheets/u);
  });
});

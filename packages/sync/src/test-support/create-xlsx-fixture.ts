/**
 * Writes a small, valid Excel workbook, `.xlsx`: sheets of cells with values,
 * formulas, number formats, merges, links, and drawings that hold charts or
 * pictures. Tests and the fixture corpus use it instead of a real workbook, so
 * no real content reaches the repository.
 */
import { createStoredZipFixture } from './create-zip-fixture.js';

export type XlsxFixtureValue = string | number | boolean;

export interface XlsxFixtureCell {
  /** The value shown, or the value the formula last computed. */
  value?: XlsxFixtureValue;
  /** A formula without `=`. */
  formula?: string;
  /** Shares the formula of group `index`; the group's first cell names `ref`. */
  shared?: { index: number; ref?: string };
  /** The number format, by its code. */
  format?: string;
  /** An error value, `#DIV/0!`. */
  error?: string;
  /** An external link. */
  link?: string;
}

export interface XlsxFixtureSheet {
  name: string;
  /** Cells by address, `B5`. */
  cells?: Readonly<Record<string, XlsxFixtureValue | XlsxFixtureCell>>;
  hidden?: boolean;
  /** A sheet that is only a chart. */
  chartSheet?: boolean;
  merges?: readonly string[];
  charts?: number;
  images?: number;
}

export interface XlsxFixture {
  sheets: readonly XlsxFixtureSheet[];
  /** Defined names, to a reference such as `Plan!$B$2`. */
  names?: Readonly<Record<string, string>>;
  date1904?: boolean;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const ADDRESS = /^([A-Z]+)(\d+)$/u;

function position(address: string): { row: number; column: string } {
  const match = ADDRESS.exec(address);
  if (!match) {
    throw new Error(`Not a cell address: ${address}`);
  }
  return { row: Number(match[2]), column: match[1] ?? 'A' };
}

function columnNumber(letters: string): number {
  return [...letters].reduce(
    (total, letter) => total * 26 + letter.charCodeAt(0) - 64,
    0,
  );
}

export function createXlsxFixture(fixture: XlsxFixture): Uint8Array {
  const strings: string[] = [];
  const stringIndex = (value: string) => {
    const known = strings.indexOf(value);
    if (known >= 0) {
      return known;
    }
    strings.push(value);
    return strings.length - 1;
  };
  const formats: string[] = [];
  const styleOf = (code: string | undefined) => {
    if (code === undefined) {
      return 0;
    }
    const known = formats.indexOf(code);
    if (known >= 0) {
      return known + 1;
    }
    formats.push(code);
    return formats.length;
  };

  const entries: Array<{ path: string; bytes: string }> = [];
  const workbookRelationships: string[] = [];
  const sheetElements: string[] = [];
  let drawingCount = 0;

  fixture.sheets.forEach((sheet, index) => {
    const id = `rId${index + 1}`;
    const state = sheet.hidden ? ' state="hidden"' : '';
    sheetElements.push(
      `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}"${state} r:id="${id}"/>`,
    );
    if (sheet.chartSheet) {
      workbookRelationships.push(
        `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartsheet" Target="chartsheets/sheet${index + 1}.xml"/>`,
      );
      entries.push({
        path: `xl/chartsheets/sheet${index + 1}.xml`,
        bytes:
          '<chartsheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>',
      });
      return;
    }
    workbookRelationships.push(
      `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
    );

    const rows = new Map<number, string[]>();
    const links: Array<{ address: string; url: string }> = [];
    const sorted = Object.entries(sheet.cells ?? {}).sort(([left], [right]) => {
      const a = position(left);
      const b = position(right);
      return a.row - b.row || columnNumber(a.column) - columnNumber(b.column);
    });
    for (const [address, raw] of sorted) {
      const cell: XlsxFixtureCell =
        typeof raw === 'object' ? raw : { value: raw };
      const style = styleOf(cell.format);
      const styleAttribute = style ? ` s="${style}"` : '';
      let formula = '';
      if (cell.shared) {
        const ref = cell.shared.ref ? ` ref="${cell.shared.ref}"` : '';
        formula = `<f t="shared"${ref} si="${cell.shared.index}">${escapeXml(cell.formula ?? '')}</f>`;
      } else if (cell.formula !== undefined) {
        formula = `<f>${escapeXml(cell.formula)}</f>`;
      }
      let element: string;
      if (cell.error !== undefined) {
        element = `<c r="${address}" t="e"${styleAttribute}>${formula}<v>${escapeXml(cell.error)}</v></c>`;
      } else if (typeof cell.value === 'number') {
        element = `<c r="${address}"${styleAttribute}>${formula}<v>${cell.value}</v></c>`;
      } else if (typeof cell.value === 'boolean') {
        element = `<c r="${address}" t="b"${styleAttribute}>${formula}<v>${cell.value ? 1 : 0}</v></c>`;
      } else if (typeof cell.value === 'string') {
        element = formula
          ? `<c r="${address}" t="str"${styleAttribute}>${formula}<v>${escapeXml(cell.value)}</v></c>`
          : `<c r="${address}" t="s"${styleAttribute}><v>${stringIndex(cell.value)}</v></c>`;
      } else {
        element = `<c r="${address}"${styleAttribute}>${formula}</c>`;
      }
      const { row } = position(address);
      rows.set(row, [...(rows.get(row) ?? []), element]);
      if (cell.link) {
        links.push({ address, url: cell.link });
      }
    }

    const sheetRelationships: string[] = links.map(
      (link, linkIndex) =>
        `<Relationship Id="rIdLink${linkIndex + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escapeXml(link.url)}" TargetMode="External"/>`,
    );
    let drawing = '';
    if ((sheet.charts ?? 0) > 0 || (sheet.images ?? 0) > 0) {
      drawingCount += 1;
      sheetRelationships.push(
        `<Relationship Id="rIdDrawing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingCount}.xml"/>`,
      );
      drawing = '<drawing r:id="rIdDrawing"/>';
      const anchors = [
        ...Array.from(
          { length: sheet.charts ?? 0 },
          () =>
            '<xdr:twoCellAnchor><xdr:graphicFrame><a:graphic><a:graphicData><c:chart r:id="rIdChart"/></a:graphicData></a:graphic></xdr:graphicFrame></xdr:twoCellAnchor>',
        ),
        ...Array.from(
          { length: sheet.images ?? 0 },
          () => '<xdr:twoCellAnchor><xdr:pic/></xdr:twoCellAnchor>',
        ),
      ];
      entries.push({
        path: `xl/drawings/drawing${drawingCount}.xml`,
        bytes: `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchors.join('')}</xdr:wsDr>`,
      });
    }

    const sheetData = [...rows]
      .sort(([left], [right]) => left - right)
      .map(([row, cells]) => `<row r="${row}">${cells.join('')}</row>`)
      .join('');
    const merges = sheet.merges?.length
      ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((ref) => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>`
      : '';
    const hyperlinks = links.length
      ? `<hyperlinks>${links.map((link, linkIndex) => `<hyperlink ref="${link.address}" r:id="rIdLink${linkIndex + 1}"/>`).join('')}</hyperlinks>`
      : '';
    entries.push({
      path: `xl/worksheets/sheet${index + 1}.xml`,
      bytes: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData>${sheetData}</sheetData>${merges}${hyperlinks}${drawing}</worksheet>`,
    });
    if (sheetRelationships.length > 0) {
      entries.push({
        path: `xl/worksheets/_rels/sheet${index + 1}.xml.rels`,
        bytes: `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetRelationships.join('')}</Relationships>`,
      });
    }
  });

  const names = Object.entries(fixture.names ?? {});
  entries.push(
    {
      path: '[Content_Types].xml',
      bytes:
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    },
    {
      path: '_rels/.rels',
      bytes:
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    },
    {
      path: 'xl/workbook.xml',
      bytes: `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${fixture.date1904 ? '<workbookPr date1904="1"/>' : ''}<sheets>${sheetElements.join('')}</sheets>${names.length ? `<definedNames>${names.map(([name, ref]) => `<definedName name="${escapeXml(name)}">${escapeXml(ref)}</definedName>`).join('')}</definedNames>` : ''}</workbook>`,
    },
    {
      path: 'xl/_rels/workbook.xml.rels',
      bytes: `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${workbookRelationships.join('')}<Relationship Id="rIdStrings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    {
      path: 'xl/sharedStrings.xml',
      bytes: `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((value) => `<si><t xml:space="preserve">${escapeXml(value)}</t></si>`).join('')}</sst>`,
    },
    {
      path: 'xl/styles.xml',
      bytes: `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${formats.length ? `<numFmts count="${formats.length}">${formats.map((code, formatIndex) => `<numFmt numFmtId="${164 + formatIndex}" formatCode="${escapeXml(code)}"/>`).join('')}</numFmts>` : ''}<cellXfs count="${formats.length + 1}"><xf numFmtId="0"/>${formats.map((_, formatIndex) => `<xf numFmtId="${164 + formatIndex}" applyNumberFormat="1"/>`).join('')}</cellXfs></styleSheet>`,
    },
  );
  return createStoredZipFixture(
    entries.sort((left, right) => (left.path < right.path ? -1 : 1)),
  );
}

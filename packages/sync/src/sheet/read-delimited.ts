/**
 * Reading a CSV or tab-separated file as a spreadsheet of one sheet
 * (ADR-046). Fields follow RFC 4180: a quoted field may hold the separator,
 * line breaks and doubled quotes. A CSV file saved where a comma is the
 * decimal mark separates fields with semicolons, so a header line with more
 * semicolons than commas is read that way.
 */
import {
  CellBudget,
  cellText,
  type SheetCell,
  type WorkbookData,
} from './workbook.js';

const NUMBER = /^[-+(]?[$€£¥₽]?\s?\d[\d,. ]*(?:[eE][-+]?\d+)?%?\)?$/u;

function separatorOf(text: string, tabs: boolean): string {
  if (tabs) {
    return '\t';
  }
  const firstLine = text.slice(0, text.search(/\r?\n|$/u));
  const semicolons = firstLine.split(';').length;
  const commas = firstLine.split(',').length;
  return semicolons > commas ? ';' : ',';
}

/** The records of a delimited text, each a list of its fields. */
function* records(text: string, separator: string): Generator<string[]> {
  let field = '';
  let record: string[] = [];
  let quoted = false;
  let index = 0;
  while (index < text.length) {
    const character = text[index] ?? '';
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
      } else {
        field += character;
      }
      index += 1;
      continue;
    }
    if (character === '"' && field === '') {
      quoted = true;
    } else if (character === separator) {
      record.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      record.push(field);
      yield record;
      record = [];
      field = '';
      if (character === '\r' && text[index + 1] === '\n') {
        index += 1;
      }
    } else {
      field += character;
    }
    index += 1;
  }
  if (field !== '' || record.length > 0) {
    record.push(field);
    yield record;
  }
}

/**
 * The file's text. UTF-16 when it opens with that byte order mark, as Excel's
 * "Unicode text" does; otherwise UTF-8 when it is valid UTF-8; otherwise
 * Windows-1251, the code page Excel saves CSV in on a Russian system, where a
 * UTF-8 reading would turn every Cyrillic letter into a replacement mark.
 */
function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1251').decode(bytes);
  }
}

/** A delimited file as a workbook with one sheet, named after the file. */
export function readDelimited(
  bytes: Uint8Array,
  name: string,
  tabs: boolean,
): WorkbookData {
  const text = decodeText(bytes).replace(/^\uFEFF/u, '');
  const separator = separatorOf(text, tabs);
  const budget = new CellBudget();
  const cells: SheetCell[] = [];
  let truncatedAfterRow: number | undefined;
  let row = 0;
  let lastRow: number | undefined;
  for (const record of records(text, separator)) {
    for (const [column, value] of record.entries()) {
      const shown = cellText(value);
      if (!shown) {
        continue;
      }
      if (truncatedAfterRow !== undefined || !budget.admit(row)) {
        truncatedAfterRow ??= (lastRow ?? -1) + 1;
        break;
      }
      lastRow = row;
      cells.push({
        row,
        column,
        text: shown,
        kind: NUMBER.test(shown) ? 'number' : 'text',
      });
    }
    if (truncatedAfterRow !== undefined) {
      break;
    }
    row += 1;
  }
  return {
    sheets: [
      {
        name,
        cells,
        merges: [],
        charts: 0,
        images: 0,
        ...(truncatedAfterRow === undefined ? {} : { truncatedAfterRow }),
      },
    ],
    hiddenSheets: [],
    chartSheets: 0,
    omittedSheets: 0,
    names: [],
  };
}

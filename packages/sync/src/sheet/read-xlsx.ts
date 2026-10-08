/**
 * Reading an Excel workbook, `.xlsx`, the way a Google Sheet is exported too
 * (ADR-046).
 *
 * A workbook is a ZIP archive of XML parts. It is opened with the archive
 * reader the HTML export uses, under the same limits, and each part is read by
 * a streaming XML parser that keeps only what a page shows: each visible
 * sheet's cells, the value each formula last computed, the number format each
 * value is shown with, merged cells, links, and how many charts and pictures
 * are drawn on the sheet. Macros, external links, comments and everything else
 * in the archive are never read.
 */
import { posix } from 'node:path';

import { Parser } from 'htmlparser2';
import { format, isDateFormat } from 'numfmt';

import { extractSafeZipEntries, UnsafeZipError } from '../archive/safe-zip.js';
import { UnsafeAssetError } from '../assets/validate-asset.js';
import { isAllowedLinkUrl } from '../conversion/url-policy.js';
import {
  columnIndex as columnOf,
  parseRangeAddress,
  shiftFormula,
  type CellRange,
} from './formula.js';
import {
  CellBudget,
  cellText,
  MAX_SHEETS,
  type CellKind,
  type DefinedName,
  type SheetCell,
  type WorkbookData,
  type WorksheetData,
} from './workbook.js';

type Attributes = Readonly<Record<string, string>>;

interface XmlHandlers {
  open?: (name: string, attributes: Attributes) => void;
  text?: (text: string) => void;
  close?: (name: string) => void;
}

function localName(name: string): string {
  const colon = name.indexOf(':');
  return colon < 0 ? name : name.slice(colon + 1);
}

/** An attribute by its local name, whatever namespace prefix it carries. */
function attribute(attributes: Attributes, name: string): string | undefined {
  if (attributes[name] !== undefined) {
    return attributes[name];
  }
  for (const [key, value] of Object.entries(attributes)) {
    if (localName(key) === name) {
      return value;
    }
  }
  return undefined;
}

function readXml(bytes: Uint8Array, handlers: XmlHandlers): void {
  const parser = new Parser(
    {
      onopentag: (name, attributes) =>
        handlers.open?.(localName(name), attributes),
      ontext: (text) => handlers.text?.(text),
      onclosetag: (name) => handlers.close?.(localName(name)),
    },
    { xmlMode: true, decodeEntities: true },
  );
  parser.write(Buffer.from(bytes).toString('utf8'));
  parser.end();
}

/** The parts of the archive, found whatever case a relationship names. */
class Parts {
  private readonly byPath = new Map<string, Uint8Array>();

  constructor(entries: ReadonlyArray<{ path: string; bytes: Uint8Array }>) {
    for (const entry of entries) {
      this.byPath.set(entry.path.toLowerCase(), entry.bytes);
    }
  }

  get(path: string): Uint8Array | undefined {
    return this.byPath.get(path.replace(/^\/+/u, '').toLowerCase());
  }
}

interface Relationship {
  type: string;
  target: string;
  external: boolean;
}

/** The relationships of the part at `path`, by ID, with targets resolved. */
function relationships(parts: Parts, path: string): Map<string, Relationship> {
  const directory = posix.dirname(path);
  const bytes = parts.get(
    posix.join(directory, '_rels', `${posix.basename(path)}.rels`),
  );
  const found = new Map<string, Relationship>();
  if (!bytes) {
    return found;
  }
  readXml(bytes, {
    open(name, attributes) {
      if (name !== 'Relationship') {
        return;
      }
      const id = attribute(attributes, 'Id');
      const target = attribute(attributes, 'Target');
      if (!id || target === undefined) {
        return;
      }
      const external = attribute(attributes, 'TargetMode') === 'External';
      found.set(id, {
        type: attribute(attributes, 'Type') ?? '',
        external,
        target: external
          ? target
          : target.startsWith('/')
            ? target.slice(1)
            : posix.normalize(posix.join(directory, target)),
      });
    },
  });
  return found;
}

/** Excel's built-in number formats, by ID, where they differ from General. */
const BUILT_IN_FORMATS: Readonly<Record<number, string>> = {
  1: '0',
  2: '0.00',
  3: '#,##0',
  4: '#,##0.00',
  9: '0%',
  10: '0.00%',
  11: '0.00E+00',
  12: '# ?/?',
  13: '# ??/??',
  // Shown in the reader's own date order by Excel; the site writes ISO dates.
  14: 'yyyy-mm-dd',
  15: 'd-mmm-yy',
  16: 'd-mmm',
  17: 'mmm-yy',
  18: 'h:mm AM/PM',
  19: 'h:mm:ss AM/PM',
  20: 'h:mm',
  21: 'h:mm:ss',
  22: 'yyyy-mm-dd h:mm',
  37: '#,##0 ;(#,##0)',
  38: '#,##0 ;(#,##0)',
  39: '#,##0.00;(#,##0.00)',
  40: '#,##0.00;(#,##0.00)',
  45: 'mm:ss',
  46: '[h]:mm:ss',
  47: 'mm:ss.0',
  48: '##0.0E+0',
  49: '@',
};

/** The number format of each cell style, by the style's index. */
function readStyles(bytes: Uint8Array | undefined): string[] {
  if (!bytes) {
    return [];
  }
  const custom = new Map<number, string>();
  const styles: string[] = [];
  let inCellFormats = false;
  readXml(bytes, {
    open(name, attributes) {
      if (name === 'numFmt') {
        const id = Number(attribute(attributes, 'numFmtId'));
        const code = attribute(attributes, 'formatCode');
        if (Number.isInteger(id) && code !== undefined) {
          custom.set(id, code);
        }
      } else if (name === 'cellXfs') {
        inCellFormats = true;
      } else if (name === 'xf' && inCellFormats) {
        const id = Number(attribute(attributes, 'numFmtId') ?? '0');
        styles.push(custom.get(id) ?? BUILT_IN_FORMATS[id] ?? 'General');
      }
    },
    close(name) {
      if (name === 'cellXfs') {
        inCellFormats = false;
      }
    },
  });
  return styles;
}

/** The workbook's shared strings, rich text flattened, phonetic runs left out. */
function readSharedStrings(bytes: Uint8Array | undefined): string[] {
  if (!bytes) {
    return [];
  }
  const strings: string[] = [];
  let current: string | undefined;
  let inText = false;
  let phonetic = 0;
  readXml(bytes, {
    open(name) {
      if (name === 'si') {
        current = '';
      } else if (name === 'rPh') {
        phonetic += 1;
      } else if (name === 't' && phonetic === 0) {
        inText = true;
      }
    },
    text(text) {
      if (inText && current !== undefined) {
        current += text;
      }
    },
    close(name) {
      if (name === 't') {
        inText = false;
      } else if (name === 'rPh') {
        phonetic -= 1;
      } else if (name === 'si') {
        strings.push(current ?? '');
        current = undefined;
      }
    },
  });
  return strings;
}

/** A number as the workbook shows it, by its cell's number format. */
export function formatNumber(
  value: number,
  pattern: string,
  date1904: boolean,
): string {
  const options = { throws: false, nbsp: false } as const;
  let shown: string;
  try {
    shown =
      pattern === '@'
        ? format('General', value, options)
        : format(
            pattern,
            date1904 && isDateFormat(pattern) ? value + 1462 : value,
            options,
          );
  } catch {
    shown = '';
  }
  if (!shown.trim() || /^#+$/u.test(shown.trim())) {
    shown = format('General', value, options);
  }
  return cellText(shown.replaceAll(' ', ' '));
}

interface WorkbookSheet {
  name: string;
  path: string;
  hidden: boolean;
  chart: boolean;
}

interface RawCell {
  row: number;
  column: number;
  type: string;
  style: number;
  value: string;
  inline: string;
  formula?: string;
  formulaType?: string;
  sharedIndex?: string;
  sharedRange?: string;
}

interface WorksheetContext {
  name: string;
  path: string;
  strings: readonly string[];
  styles: readonly string[];
  date1904: boolean;
  budget: CellBudget;
}

function cellValue(
  cell: RawCell,
  context: WorksheetContext,
): { text: string; kind: CellKind } {
  switch (cell.type) {
    case 's': {
      const text = cellText(context.strings[Number(cell.value)] ?? '');
      return { text, kind: text ? 'text' : 'empty' };
    }
    case 'inlineStr':
    case 'str':
    case 'd': {
      const text = cellText(
        cell.type === 'inlineStr' ? cell.inline : cell.value,
      );
      return { text, kind: text ? 'text' : 'empty' };
    }
    case 'b':
      return cell.value === ''
        ? { text: '', kind: 'empty' }
        : { text: cell.value === '1' ? 'TRUE' : 'FALSE', kind: 'boolean' };
    case 'e':
      return {
        text: cellText(cell.value),
        kind: cell.value ? 'error' : 'empty',
      };
    default: {
      if (cell.value.trim() === '') {
        return { text: '', kind: 'empty' };
      }
      const number = Number(cell.value);
      if (!Number.isFinite(number)) {
        return { text: cellText(cell.value), kind: 'text' };
      }
      return {
        text: formatNumber(
          number,
          context.styles[cell.style] ?? 'General',
          context.date1904,
        ),
        kind: 'number',
      };
    }
  }
}

const CELL_ADDRESS = /^([A-Za-z]{1,3})(\d{1,7})$/u;

function readWorksheet(parts: Parts, context: WorksheetContext): WorksheetData {
  const bytes = parts.get(context.path);
  if (!bytes) {
    throw new UnsafeAssetError('A sheet of the workbook is missing.');
  }
  const links = relationships(parts, context.path);
  const cells: SheetCell[] = [];
  const merges: CellRange[] = [];
  const hyperlinks: Array<{ range: CellRange; url: string }> = [];
  const drawings: string[] = [];
  const shared = new Map<
    string,
    { row: number; column: number; formula: string }
  >();
  let rowIndex = -1;
  let columnIndex = -1;
  let cell: RawCell | undefined;
  let collecting: 'v' | 'f' | 't' | undefined;
  let inInline = false;
  let lastAdmittedRow: number | undefined;
  let truncated = false;
  context.budget.nextSheet();

  const finishCell = (raw: RawCell) => {
    let formula = raw.formula?.trim() ? raw.formula.trim() : undefined;
    if (raw.formulaType === 'shared' && raw.sharedIndex !== undefined) {
      const master = shared.get(raw.sharedIndex);
      if (formula !== undefined) {
        shared.set(raw.sharedIndex, {
          row: raw.row,
          column: raw.column,
          formula,
        });
      } else if (master) {
        formula = shiftFormula(
          master.formula,
          raw.row - master.row,
          raw.column - master.column,
        );
      }
    }
    const { text, kind } = cellValue(raw, context);
    if (kind === 'empty' && formula === undefined) {
      return;
    }
    if (truncated || !context.budget.admit(raw.row)) {
      truncated = true;
      return;
    }
    lastAdmittedRow = Math.max(lastAdmittedRow ?? raw.row, raw.row);
    cells.push({
      row: raw.row,
      column: raw.column,
      text,
      kind,
      ...(formula === undefined ? {} : { formula }),
    });
  };

  readXml(bytes, {
    open(name, attributes) {
      switch (name) {
        case 'row': {
          const declared = Number(attribute(attributes, 'r'));
          rowIndex =
            Number.isInteger(declared) && declared > 0
              ? declared - 1
              : rowIndex + 1;
          columnIndex = -1;
          break;
        }
        case 'c': {
          const address = CELL_ADDRESS.exec(attribute(attributes, 'r') ?? '');
          let row = rowIndex;
          let column = columnIndex + 1;
          if (address) {
            row = Number(address[2]) - 1;
            column = columnOf(address[1] ?? 'A');
          }
          rowIndex = Math.max(rowIndex, row);
          columnIndex = column;
          cell = {
            row,
            column,
            type: attribute(attributes, 't') ?? 'n',
            style: Number(attribute(attributes, 's') ?? '0') || 0,
            value: '',
            inline: '',
          };
          break;
        }
        case 'v':
          collecting = cell ? 'v' : undefined;
          break;
        case 'f':
          if (cell) {
            collecting = 'f';
            cell.formula = '';
            const type = attribute(attributes, 't');
            const sharedIndex = attribute(attributes, 'si');
            if (type !== undefined) {
              cell.formulaType = type;
            }
            if (sharedIndex !== undefined) {
              cell.sharedIndex = sharedIndex;
            }
          }
          break;
        case 'is':
          inInline = true;
          break;
        case 't':
          collecting = cell && inInline ? 't' : collecting;
          break;
        case 'mergeCell': {
          const range = parseRangeAddress(attribute(attributes, 'ref') ?? '');
          if (range) {
            merges.push(range);
          }
          break;
        }
        case 'hyperlink': {
          const range = parseRangeAddress(attribute(attributes, 'ref') ?? '');
          const target = links.get(attribute(attributes, 'id') ?? '');
          if (
            range &&
            target?.external &&
            /^(?:https?|mailto):/iu.test(target.target) &&
            isAllowedLinkUrl(target.target)
          ) {
            hyperlinks.push({ range, url: target.target });
          }
          break;
        }
        case 'drawing': {
          const target = links.get(attribute(attributes, 'id') ?? '');
          if (target && !target.external) {
            drawings.push(target.target);
          }
          break;
        }
        default:
          break;
      }
    },
    text(text) {
      if (!cell) {
        return;
      }
      if (collecting === 'v') {
        cell.value += text;
      } else if (collecting === 'f') {
        cell.formula = (cell.formula ?? '') + text;
      } else if (collecting === 't') {
        cell.inline += text;
      }
    },
    close(name) {
      if (name === 'v' || name === 'f' || name === 't') {
        collecting = undefined;
      } else if (name === 'is') {
        inInline = false;
      } else if (name === 'c' && cell) {
        finishCell(cell);
        cell = undefined;
      }
    },
  });

  for (const link of hyperlinks) {
    for (const target of cells) {
      if (
        target.row >= link.range.top &&
        target.row <= link.range.bottom &&
        target.column >= link.range.left &&
        target.column <= link.range.right &&
        target.kind !== 'empty'
      ) {
        target.link = link.url;
      }
    }
  }

  let charts = 0;
  let images = 0;
  for (const drawing of drawings) {
    const drawingBytes = parts.get(drawing);
    if (!drawingBytes) {
      continue;
    }
    readXml(drawingBytes, {
      open(name) {
        if (name === 'chart') {
          charts += 1;
        } else if (name === 'pic') {
          images += 1;
        }
      },
    });
  }

  cells.sort(
    (left, right) => left.row - right.row || left.column - right.column,
  );
  return {
    name: context.name,
    cells,
    merges,
    charts,
    images,
    ...(truncated && lastAdmittedRow !== undefined
      ? { truncatedAfterRow: lastAdmittedRow + 1 }
      : truncated
        ? { truncatedAfterRow: 0 }
        : {}),
  };
}

/** Whether the bytes open as a ZIP archive, as every workbook does. */
function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b;
}

/**
 * The visible sheets of a workbook. A file that is not a workbook, or one
 * whose archive the sync will not open, is refused with an error that names
 * the problem and nothing of the content.
 */
export function readXlsx(bytes: Uint8Array): WorkbookData {
  if (!looksLikeZip(bytes)) {
    throw new UnsafeAssetError(
      'The spreadsheet is not an Excel workbook, or it is protected with a password.',
    );
  }
  let parts: Parts;
  try {
    parts = new Parts(extractSafeZipEntries(bytes));
  } catch (error: unknown) {
    if (error instanceof UnsafeZipError) {
      throw new UnsafeAssetError(
        `The workbook cannot be opened safely: ${error.message}`,
      );
    }
    throw error;
  }
  const rootRelationships = relationships(parts, '');
  const workbookPath =
    [...rootRelationships.values()].find((relationship) =>
      relationship.type.endsWith('/officeDocument'),
    )?.target ?? 'xl/workbook.xml';
  const workbookBytes = parts.get(workbookPath);
  if (!workbookBytes) {
    throw new UnsafeAssetError('The workbook has no list of sheets.');
  }
  const workbookLinks = relationships(parts, workbookPath);

  const sheets: WorkbookSheet[] = [];
  const names: Array<{ name: string; value: string }> = [];
  let date1904 = false;
  let name: { name: string; hidden: boolean } | undefined;
  let nameValue = '';
  readXml(workbookBytes, {
    open(element, attributes) {
      if (element === 'sheet') {
        const link = workbookLinks.get(attribute(attributes, 'id') ?? '');
        if (!link) {
          return;
        }
        const state = attribute(attributes, 'state');
        sheets.push({
          name: cellText(attribute(attributes, 'name') ?? ''),
          path: link.target,
          hidden: state === 'hidden' || state === 'veryHidden',
          chart: link.type.endsWith('/chartsheet'),
        });
      } else if (element === 'workbookPr') {
        const value = attribute(attributes, 'date1904');
        date1904 = value === '1' || value === 'true';
      } else if (element === 'definedName') {
        name = {
          name: attribute(attributes, 'name') ?? '',
          hidden: attribute(attributes, 'hidden') === '1',
        };
        nameValue = '';
      }
    },
    text(text) {
      if (name) {
        nameValue += text;
      }
    },
    close(element) {
      if (element === 'definedName' && name) {
        if (!name.hidden && name.name && !name.name.startsWith('_xlnm.')) {
          names.push({ name: name.name, value: nameValue });
        }
        name = undefined;
      }
    },
  });

  const strings = readSharedStrings(
    parts.get(
      [...workbookLinks.values()].find((link) =>
        link.type.endsWith('/sharedStrings'),
      )?.target ?? 'xl/sharedStrings.xml',
    ),
  );
  const styles = readStyles(
    parts.get(
      [...workbookLinks.values()].find((link) => link.type.endsWith('/styles'))
        ?.target ?? 'xl/styles.xml',
    ),
  );

  const budget = new CellBudget();
  const visible = sheets.filter((sheet) => !sheet.hidden && !sheet.chart);
  const worksheets: WorksheetData[] = [];
  for (const sheet of visible.slice(0, MAX_SHEETS)) {
    if (budget.workbookFull) {
      worksheets.push({
        name: sheet.name,
        cells: [],
        merges: [],
        charts: 0,
        images: 0,
        truncatedAfterRow: 0,
      });
      continue;
    }
    worksheets.push(
      readWorksheet(parts, {
        name: sheet.name,
        path: sheet.path,
        strings,
        styles,
        date1904,
        budget,
      }),
    );
  }

  return {
    sheets: worksheets,
    hiddenSheets: sheets.filter((sheet) => sheet.hidden).length,
    chartSheets: sheets.filter((sheet) => !sheet.hidden && sheet.chart).length,
    omittedSheets: Math.max(0, visible.length - MAX_SHEETS),
    names: definedNames(names, sheets),
  };
}

/** Names that point at one range of one sheet: the rest are left out. */
function definedNames(
  names: ReadonlyArray<{ name: string; value: string }>,
  sheets: readonly WorkbookSheet[],
): DefinedName[] {
  const defined: DefinedName[] = [];
  for (const entry of names) {
    const match =
      /^(?:'((?:[^']|'')+)'|([^'!]+))!(\$?[A-Za-z]{1,3}\$?\d{1,7}(?::\$?[A-Za-z]{1,3}\$?\d{1,7})?)$/u.exec(
        entry.value.trim(),
      );
    if (!match) {
      continue;
    }
    const sheet = (match[1] ?? match[2] ?? '').replaceAll("''", "'");
    const range = parseRangeAddress((match[3] ?? '').replaceAll('$', ''));
    if (!range || !sheets.some((candidate) => candidate.name === sheet)) {
      continue;
    }
    defined.push({ name: entry.name, sheet, range });
  }
  return defined.sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  );
}

/**
 * A spreadsheet as the site reads it (ADR-046): its visible sheets, each a set
 * of cells holding the text the workbook shows, with the formulas behind them.
 *
 * Both readers produce this, the one for workbooks and the one for CSV files,
 * so everything after reading is the same for every kind of spreadsheet.
 */
import type { CellRange } from './formula.js';

/** What a cell holds, as far as laying it out and naming it go. */
export type CellKind = 'text' | 'number' | 'boolean' | 'error' | 'empty';

export interface SheetCell {
  /** Zero-based. */
  row: number;
  column: number;
  /** The value as the workbook shows it, on one line. */
  text: string;
  kind: CellKind;
  /** The formula, without its `=`, when the cell has one. */
  formula?: string;
  /** Where the cell links to, when it does. */
  link?: string;
}

export interface WorksheetData {
  name: string;
  /** In reading order: by row, then by column. */
  cells: SheetCell[];
  merges: CellRange[];
  /** Charts and pictures drawn on the sheet, which the site does not show. */
  charts: number;
  images: number;
  /** The last row, one-based, published when the sheet was cut short. */
  truncatedAfterRow?: number;
}

/** A name the workbook defines for a cell or range, such as `TaxRate`. */
export interface DefinedName {
  name: string;
  /** The sheet the name points into. */
  sheet: string;
  range: CellRange;
}

export interface WorkbookData {
  /** The visible worksheets, in the workbook's order. */
  sheets: WorksheetData[];
  /** Worksheets hidden in the workbook, which are left out. */
  hiddenSheets: number;
  /** Sheets that hold only a chart, which are left out. */
  chartSheets: number;
  /** Visible sheets past the most a page publishes. */
  omittedSheets: number;
  names: DefinedName[];
}

/** The most rows of one sheet a page publishes. */
export const MAX_SHEET_ROWS = 2_000;
/** The most filled cells of one workbook a page publishes. */
export const MAX_WORKBOOK_CELLS = 50_000;
/** The most visible sheets of one workbook a page publishes. */
export const MAX_SHEETS = 100;
/** The longest cell text a page publishes. */
const MAX_CELL_CHARACTERS = 5_000;

/** A cell's text on one line: whitespace collapsed, and cut when very long. */
export function cellText(value: string): string {
  const text = value.replace(/\s+/gu, ' ').trim();
  return text.length > MAX_CELL_CHARACTERS
    ? `${text.slice(0, MAX_CELL_CHARACTERS - 1)}…`
    : text;
}

/**
 * Counts what a reader keeps against the limits: rows of one sheet, cells of
 * the whole workbook. Rows are counted as they arrive, so a sheet is cut after
 * the last row that fits.
 */
export class CellBudget {
  private cells = 0;
  private rows = new Set<number>();

  /** Starts counting a new sheet's rows. */
  nextSheet(): void {
    this.rows = new Set();
  }

  /**
   * Whether a filled cell in `row` fits. A row already counted always fits
   * its other cells while the workbook has room, so a row is never cut in
   * half by the row limit.
   */
  admit(row: number): boolean {
    if (this.cells >= MAX_WORKBOOK_CELLS) {
      return false;
    }
    if (!this.rows.has(row)) {
      if (this.rows.size >= MAX_SHEET_ROWS) {
        return false;
      }
      this.rows.add(row);
    }
    this.cells += 1;
    return true;
  }

  get workbookFull(): boolean {
    return this.cells >= MAX_WORKBOOK_CELLS;
  }
}

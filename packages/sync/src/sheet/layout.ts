/**
 * How a sheet is laid out (ADR-046): the blocks its empty rows and columns
 * separate, and what each filled cell is called by the text around it.
 *
 * A sheet is cut the way a page is read: into bands at its empty rows, each
 * band into columns at its empty columns, and each of those again, until no
 * empty row or column runs through a block. A merged cell fills its whole area,
 * so a heading merged across a table holds it together.
 */
import type { CellRange } from './formula.js';
import type { SheetCell, WorksheetData } from './workbook.js';

/** A filled area: a cell, or a merged cell with its whole extent. */
interface Area {
  range: CellRange;
  cell: SheetCell;
}

export interface SheetBlock {
  range: CellRange;
  /** The areas inside it, in reading order. */
  areas: Area[];
}

const COLUMNS = 16_384;

export function cellKey(row: number, column: number): number {
  return row * COLUMNS + column;
}

/** A sheet's cells by position, with each merge's covered cells. */
export class SheetGrid {
  readonly cells = new Map<number, SheetCell>();
  /** Each cell a merge covers, other than its own, to the merge's first cell. */
  private readonly covered = new Map<number, SheetCell>();
  readonly areas: Area[] = [];

  constructor(readonly sheet: WorksheetData) {
    for (const cell of sheet.cells) {
      this.cells.set(cellKey(cell.row, cell.column), cell);
    }
    /*
     * A merge is cut to the part of the sheet that holds values: one over a
     * whole row, as selecting the row and merging makes, would otherwise make
     * every block in it as wide as the sheet.
     */
    let lastRow = -1;
    let lastColumn = -1;
    for (const cell of sheet.cells) {
      if (cell.kind !== 'empty') {
        lastRow = Math.max(lastRow, cell.row);
        lastColumn = Math.max(lastColumn, cell.column);
      }
    }
    const merged = new Map<number, CellRange>();
    for (const whole of sheet.merges) {
      const anchor = this.cells.get(cellKey(whole.top, whole.left));
      if (!anchor || anchor.kind === 'empty') {
        continue;
      }
      const range = {
        ...whole,
        bottom: Math.max(whole.top, Math.min(whole.bottom, lastRow)),
        right: Math.max(whole.left, Math.min(whole.right, lastColumn)),
      };
      merged.set(cellKey(range.top, range.left), range);
      const area =
        (range.bottom - range.top + 1) * (range.right - range.left + 1);
      // A merge over a whole row or column fills nothing a table needs.
      if (area > 10_000) {
        continue;
      }
      for (let row = range.top; row <= range.bottom; row += 1) {
        for (let column = range.left; column <= range.right; column += 1) {
          if (row !== range.top || column !== range.left) {
            this.covered.set(cellKey(row, column), anchor);
          }
        }
      }
    }
    for (const cell of sheet.cells) {
      if (cell.kind === 'empty') {
        continue;
      }
      const key = cellKey(cell.row, cell.column);
      if (this.covered.has(key)) {
        continue;
      }
      this.areas.push({
        cell,
        range: merged.get(key) ?? {
          top: cell.row,
          left: cell.column,
          bottom: cell.row,
          right: cell.column,
        },
      });
    }
  }

  /** The filled cell shown at a position, a merge's value included. */
  shown(row: number, column: number): SheetCell | undefined {
    const key = cellKey(row, column);
    const cell = this.cells.get(key);
    if (cell && cell.kind !== 'empty') {
      return cell;
    }
    return this.covered.get(key);
  }

  /** Whether the cell at a position holds its own value, not a merge's. */
  isAnchor(row: number, column: number): boolean {
    const cell = this.cells.get(cellKey(row, column));
    return cell !== undefined && cell.kind !== 'empty';
  }
}

/** The rectangle the areas fill, found in one pass over tens of thousands. */
function bounds(areas: readonly Area[]): CellRange {
  const result = { top: Infinity, left: Infinity, bottom: -1, right: -1 };
  for (const { range } of areas) {
    result.top = Math.min(result.top, range.top);
    result.left = Math.min(result.left, range.left);
    result.bottom = Math.max(result.bottom, range.bottom);
    result.right = Math.max(result.right, range.right);
  }
  return result;
}

/** Groups of areas separated by at least one empty row, or column. */
function split(areas: readonly Area[], axis: 'rows' | 'columns'): Area[][] {
  const start = (area: Area) =>
    axis === 'rows' ? area.range.top : area.range.left;
  const end = (area: Area) =>
    axis === 'rows' ? area.range.bottom : area.range.right;
  const sorted = [...areas].sort(
    (left, right) =>
      start(left) - start(right) ||
      left.range.top - right.range.top ||
      left.range.left - right.range.left,
  );
  const groups: Area[][] = [];
  let current: Area[] = [];
  let reach = -1;
  for (const area of sorted) {
    if (current.length > 0 && start(area) > reach + 1) {
      groups.push(current);
      current = [];
    }
    reach = current.length === 0 ? end(area) : Math.max(reach, end(area));
    current.push(area);
  }
  if (current.length > 0) {
    groups.push(current);
  }
  return groups;
}

function readingOrder(areas: readonly Area[]): Area[] {
  return [...areas].sort(
    (left, right) =>
      left.range.top - right.range.top || left.range.left - right.range.left,
  );
}

function rowsOf(areas: readonly Area[]): Set<number> {
  const rows = new Set<number>();
  for (const { range } of areas) {
    for (let row = range.top; row <= range.bottom; row += 1) {
      rows.add(row);
    }
  }
  return rows;
}

/**
 * A column of text beside a block, on rows the block fills, is a column of
 * notes on those rows, as a model writes "assumption" or "source" next to
 * its inputs: it joins the block, even across an empty column, rather than
 * being cut off into a list of its own.
 */
function joinSideNotes(groups: readonly Area[][]): Area[][] {
  const joined: Area[][] = [];
  for (const group of groups) {
    const previous = joined.at(-1);
    const column = group[0]?.range.left;
    if (
      previous &&
      group.every(
        (area) =>
          area.cell.kind === 'text' &&
          area.range.left === column &&
          area.range.right === column,
      )
    ) {
      const rows = rowsOf(previous);
      if ([...rowsOf(group)].every((row) => rows.has(row))) {
        joined[joined.length - 1] = [...previous, ...group];
        continue;
      }
    }
    joined.push([...group]);
  }
  return joined;
}

/** The blocks of a set of areas, in reading order. */
export function cutIntoBlocks(areas: readonly Area[]): SheetBlock[] {
  if (areas.length === 0) {
    return [];
  }
  const bands = split(areas, 'rows');
  if (bands.length > 1) {
    return bands.flatMap((band) => cutIntoBlocks(band));
  }
  const columns = joinSideNotes(split(areas, 'columns'));
  if (columns.length > 1) {
    return columns.flatMap((column) => cutIntoBlocks(column));
  }
  return [{ range: bounds(areas), areas: readingOrder(areas) }];
}

/** What a cell is called by the text around it. */
export interface CellLabel {
  /** The text at the left of its row, in its block. */
  row?: string;
  /** The header of its column, in its block's first row. */
  column?: string;
}

const MAX_LABEL = 60;

function labelText(text: string): string {
  const trimmed = text.replace(/[\s:：]+$/u, '');
  return trimmed.length > MAX_LABEL
    ? `${trimmed.slice(0, MAX_LABEL - 1)}…`
    : trimmed;
}

/**
 * Labels the cells of a block. A cell's row label is the first text in its row
 * at its left; its column label is the text above it in the block's first row,
 * when the block has more than one row and the cell is not in that row.
 */
export function labelBlock(
  grid: SheetGrid,
  block: CellRange,
  labels: Map<number, CellLabel>,
  /**
   * The header a table takes from the one above it, by column, when its own
   * first row is data: every row of the block is then labelled by it.
   */
  inherited?: ReadonlyMap<number, SheetCell>,
): void {
  for (let row = block.top; row <= block.bottom; row += 1) {
    let rowLabel: string | undefined;
    for (let column = block.left; column <= block.right; column += 1) {
      const cell = grid.cells.get(cellKey(row, column));
      const shown = grid.shown(row, column);
      if (cell) {
        const label: CellLabel = {};
        if (rowLabel !== undefined) {
          label.row = rowLabel;
        }
        if (inherited || row > block.top) {
          const header = inherited
            ? inherited.get(column)
            : grid.shown(block.top, column);
          if (header?.kind === 'text' && header !== cell) {
            label.column = labelText(header.text);
          }
        }
        if (label.row !== undefined || label.column !== undefined) {
          labels.set(cellKey(row, column), label);
        }
      }
      if (rowLabel === undefined && shown?.kind === 'text') {
        rowLabel = labelText(shown.text);
      }
    }
  }
}

/**
 * The cell references in a spreadsheet formula (ADR-046).
 *
 * A formula is read only as far as its references go: where each one is, which
 * sheet and cells it names, and whether its row and column are fixed with `$`.
 * That is enough to fill in a formula shared by a range of cells, to tell
 * formulas that differ only by their offset apart from ones that differ, and to
 * name the cells a formula uses. Nothing here evaluates a formula.
 */

/** A rectangle of cells, zero-based and inclusive. */
export interface CellRange {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** One reference in a formula, where the formula writes it. */
export interface FormulaReference {
  /** Where the reference starts in the formula, and where it ends. */
  start: number;
  end: number;
  /** The sheet it names, or `undefined` for the formula's own sheet. */
  sheet?: string;
  /** The sheet as the formula writes it, `'Plan 2'!`, or an empty string. */
  prefix: string;
  /** Whether it names another workbook, which this one cannot resolve. */
  external: boolean;
  range: CellRange;
  /** Whether each edge is fixed with `$`: top, left, bottom, right. */
  fixed: [boolean, boolean, boolean, boolean];
  /** A whole column or columns (`A:C`), or a whole row or rows (`1:3`). */
  whole?: 'columns' | 'rows';
}

/** The largest row and column a workbook can have. */
const MAX_ROW = 1_048_575;
const MAX_COLUMN = 16_383;

/** `A` → 0, `Z` → 25, `AA` → 26. */
export function columnIndex(letters: string): number {
  let index = 0;
  for (const letter of letters.toUpperCase()) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }
  return index - 1;
}

/** 0 → `A`, 25 → `Z`, 26 → `AA`. */
export function columnLetters(index: number): string {
  let letters = '';
  let rest = index + 1;
  while (rest > 0) {
    const remainder = (rest - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    rest = Math.floor((rest - 1) / 26);
  }
  return letters;
}

/** A cell's address, `B5`. */
export function cellAddress(row: number, column: number): string {
  return `${columnLetters(column)}${row + 1}`;
}

/** A range's address, `B5` for one cell and `B5:M5` for more. */
export function rangeAddress(range: CellRange): string {
  const start = cellAddress(range.top, range.left);
  return range.top === range.bottom && range.left === range.right
    ? start
    : `${start}:${cellAddress(range.bottom, range.right)}`;
}

const CELL = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})$/u;

/** A cell address such as `B5` or `$B$5`, or `undefined`. */
function parseCellAddress(
  value: string,
): { row: number; column: number } | undefined {
  const match = CELL.exec(value);
  if (!match) {
    return undefined;
  }
  const row = Number(match[4]) - 1;
  const column = columnIndex(match[2] ?? '');
  return row >= 0 && row <= MAX_ROW && column >= 0 && column <= MAX_COLUMN
    ? { row, column }
    : undefined;
}

/** A range address such as `A1:C3`, or a single cell, or `undefined`. */
export function parseRangeAddress(value: string): CellRange | undefined {
  const [first, second, ...rest] = value.split(':');
  if (first === undefined || rest.length > 0) {
    return undefined;
  }
  const start = parseCellAddress(first);
  const end = second === undefined ? start : parseCellAddress(second);
  if (!start || !end) {
    return undefined;
  }
  return {
    top: Math.min(start.row, end.row),
    left: Math.min(start.column, end.column),
    bottom: Math.max(start.row, end.row),
    right: Math.max(start.column, end.column),
  };
}

/*
 * A reference: an optional sheet, quoted or not and perhaps naming another
 * workbook as `[1]`, then a cell, a range of cells, whole columns or whole
 * rows. What may not stand around it keeps a function name such as `LOG10(`
 * or a defined name such as `Rate2024` from reading as one.
 */
const REFERENCE =
  /(?<![\p{L}\p{N}_.$'\]!])(?:(?<sheet>'(?:[^']|'')+'|(?:\[\d+\])?[\p{L}_][\p{L}\p{N}_.]*)!)?(?:(?<c1>\$?[A-Za-z]{1,3}\$?\d{1,7})(?::(?<c2>\$?[A-Za-z]{1,3}\$?\d{1,7}))?|(?<col1>\$?[A-Za-z]{1,3}):(?<col2>\$?[A-Za-z]{1,3})|(?<row1>\$?\d{1,7}):(?<row2>\$?\d{1,7}))(?![\p{L}\p{N}_(!])/gu;

function sheetName(token: string | undefined): {
  sheet?: string;
  external: boolean;
} {
  if (token === undefined) {
    return { external: false };
  }
  let name = token;
  if (name.startsWith("'")) {
    name = name.slice(1, -1).replaceAll("''", "'");
  }
  const external = /^\[\d+\]/u.test(name);
  return { sheet: name.replace(/^\[\d+\]/u, ''), external };
}

function corner(token: string): {
  row: number;
  column: number;
  fixedRow: boolean;
  fixedColumn: boolean;
} {
  const match = CELL.exec(token);
  return {
    row: Number(match?.[4] ?? '1') - 1,
    column: columnIndex(match?.[2] ?? 'A'),
    fixedRow: match?.[3] === '$',
    fixedColumn: match?.[1] === '$',
  };
}

/** The spans of a formula's string literals, which hold no references. */
function stringSpans(formula: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let index = 0;
  while (index < formula.length) {
    const open = formula.indexOf('"', index);
    if (open < 0) {
      break;
    }
    let close = open + 1;
    while (close < formula.length) {
      if (formula[close] === '"') {
        if (formula[close + 1] === '"') {
          close += 2;
          continue;
        }
        break;
      }
      close += 1;
    }
    spans.push([open, close]);
    index = close + 1;
  }
  return spans;
}

/** Every reference in a formula, in the order it writes them. */
export function formulaReferences(formula: string): FormulaReference[] {
  const strings = stringSpans(formula);
  const inString = (position: number) =>
    strings.some(([open, close]) => position >= open && position <= close);
  const references: FormulaReference[] = [];
  for (const match of formula.matchAll(REFERENCE)) {
    const start = match.index;
    if (inString(start)) {
      continue;
    }
    const groups = match.groups ?? {};
    const { sheet, external } = sheetName(groups['sheet']);
    const common = {
      start,
      end: start + match[0].length,
      ...(sheet === undefined ? {} : { sheet }),
      prefix: groups['sheet'] === undefined ? '' : `${groups['sheet']}!`,
      external,
    };
    if (groups['c1'] !== undefined) {
      const first = corner(groups['c1']);
      const second = corner(groups['c2'] ?? groups['c1']);
      if (
        first.row > MAX_ROW ||
        second.row > MAX_ROW ||
        first.column > MAX_COLUMN ||
        second.column > MAX_COLUMN ||
        first.row < 0 ||
        second.row < 0
      ) {
        continue;
      }
      references.push({
        ...common,
        range: {
          top: Math.min(first.row, second.row),
          left: Math.min(first.column, second.column),
          bottom: Math.max(first.row, second.row),
          right: Math.max(first.column, second.column),
        },
        fixed: [
          first.fixedRow,
          first.fixedColumn,
          second.fixedRow,
          second.fixedColumn,
        ],
      });
      continue;
    }
    if (groups['col1'] !== undefined && groups['col2'] !== undefined) {
      const left = columnIndex(groups['col1'].replace('$', ''));
      const right = columnIndex(groups['col2'].replace('$', ''));
      if (left > MAX_COLUMN || right > MAX_COLUMN) {
        continue;
      }
      references.push({
        ...common,
        range: {
          top: 0,
          left: Math.min(left, right),
          bottom: MAX_ROW,
          right: Math.max(left, right),
        },
        fixed: [
          true,
          groups['col1'].startsWith('$'),
          true,
          groups['col2'].startsWith('$'),
        ],
        whole: 'columns',
      });
      continue;
    }
    if (groups['row1'] !== undefined && groups['row2'] !== undefined) {
      const top = Number(groups['row1'].replace('$', '')) - 1;
      const bottom = Number(groups['row2'].replace('$', '')) - 1;
      if (top < 0 || bottom < 0 || top > MAX_ROW || bottom > MAX_ROW) {
        continue;
      }
      references.push({
        ...common,
        range: {
          top: Math.min(top, bottom),
          left: 0,
          bottom: Math.max(top, bottom),
          right: MAX_COLUMN,
        },
        fixed: [
          groups['row1'].startsWith('$'),
          true,
          groups['row2'].startsWith('$'),
          true,
        ],
        whole: 'rows',
      });
    }
  }
  return references;
}

function writeReference(reference: FormulaReference, range: CellRange): string {
  const { prefix } = reference;
  const [fixedTop, fixedLeft, fixedBottom, fixedRight] = reference.fixed;
  if (reference.whole === 'columns') {
    return `${prefix}${fixedLeft ? '$' : ''}${columnLetters(range.left)}:${fixedRight ? '$' : ''}${columnLetters(range.right)}`;
  }
  if (reference.whole === 'rows') {
    return `${prefix}${fixedTop ? '$' : ''}${range.top + 1}:${fixedBottom ? '$' : ''}${range.bottom + 1}`;
  }
  const start = `${fixedLeft ? '$' : ''}${columnLetters(range.left)}${fixedTop ? '$' : ''}${range.top + 1}`;
  const single =
    reference.range.top === reference.range.bottom &&
    reference.range.left === reference.range.right;
  return single
    ? `${prefix}${start}`
    : `${prefix}${start}:${fixedRight ? '$' : ''}${columnLetters(range.right)}${fixedBottom ? '$' : ''}${range.bottom + 1}`;
}

function shifted(
  reference: FormulaReference,
  rows: number,
  columns: number,
): CellRange | undefined {
  const [fixedTop, fixedLeft, fixedBottom, fixedRight] = reference.fixed;
  const range = {
    top: reference.range.top + (fixedTop ? 0 : rows),
    left: reference.range.left + (fixedLeft ? 0 : columns),
    bottom: reference.range.bottom + (fixedBottom ? 0 : rows),
    right: reference.range.right + (fixedRight ? 0 : columns),
  };
  return range.top < 0 ||
    range.left < 0 ||
    range.bottom > MAX_ROW ||
    range.right > MAX_COLUMN
    ? undefined
    : range;
}

/**
 * The formula a cell holds when it shares another cell's formula, `rows`
 * below and `columns` to the right: each reference not fixed with `$` moves
 * by as much, as Excel fills a formula down or across.
 */
export function shiftFormula(
  formula: string,
  rows: number,
  columns: number,
): string {
  let result = '';
  let position = 0;
  for (const reference of formulaReferences(formula)) {
    const range = shifted(reference, rows, columns);
    result += formula.slice(position, reference.start);
    result += range === undefined ? '#REF!' : writeReference(reference, range);
    position = reference.end;
  }
  return result + formula.slice(position);
}

/**
 * The formula with every reference written relative to the cell that holds
 * it, as R1C1 notation does: two cells whose formulas differ only by their
 * offset, as a row of monthly totals does, have the same shape.
 */
export function formulaShape(
  formula: string,
  row: number,
  column: number,
): string {
  let result = '';
  let position = 0;
  const offset = (value: number, fixed: boolean, origin: number) =>
    fixed ? `${value}` : `[${value - origin}]`;
  for (const reference of formulaReferences(formula)) {
    const [fixedTop, fixedLeft, fixedBottom, fixedRight] = reference.fixed;
    const { range } = reference;
    result += formula.slice(position, reference.start);
    result += `${reference.external ? '[x]' : ''}${reference.sheet ?? ''}!R${offset(range.top, fixedTop, row)}C${offset(range.left, fixedLeft, column)}:R${offset(range.bottom, fixedBottom, row)}C${offset(range.right, fixedRight, column)}`;
    position = reference.end;
  }
  return result + formula.slice(position);
}

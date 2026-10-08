/**
 * A spreadsheet as a page (ADR-046).
 *
 * Every visible sheet is published, and its shape decides its form: it is cut
 * into blocks at its empty rows and columns, and each block becomes a table, a
 * list or a paragraph. A sheet with formulas then says how it calculates: each
 * distinct formula once, with the cells it fills and the labels of the cells it
 * uses, then the inputs it depends on and the results it produces.
 *
 * The page is built as a Markdown tree and serialized, never concatenated, so
 * nothing in a cell becomes markup, a link or HTML on the page.
 */
import type {
  Heading,
  List,
  ListItem,
  Paragraph,
  PhrasingContent,
  Root,
  RootContent,
  Table,
  TableCell,
  TableRow,
} from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';

import { truncateDescription } from '../markdown/normalize-markdown.js';
import {
  formulaIdentifiers,
  formulaReferences,
  formulaShape,
  rangeAddress,
  type CellRange,
  type FormulaReference,
} from './formula.js';
import {
  cellKey,
  cutIntoBlocks,
  labelBlock,
  SheetGrid,
  type CellLabel,
  type SheetBlock,
} from './layout.js';
import type { SheetCell, WorkbookData } from './workbook.js';

/**
 * The version of the page this module writes. A spreadsheet whose page an
 * earlier version wrote is read again, even when the file has not changed.
 */
export const SHEET_VERSION = 1;

/** The most formulas, inputs and results one sheet's section lists. */
const MAX_FORMULAS = 200;
const MAX_INPUTS = 100;
const MAX_RESULTS = 50;
/** What a formula on the page names a hidden sheet. */
const HIDDEN_SHEET = '[hidden sheet]';
/** The longest formula a page quotes whole. */
const MAX_FORMULA_CHARACTERS = 500;

const markdownProcessor = unified()
  .use(remarkGfm, { tablePipeAlign: false })
  .use(remarkStringify, {
    bullet: '-',
    emphasis: '*',
    fences: true,
    listItemIndent: 'one',
    strong: '*',
  });

export interface SheetMarkdown {
  body: string;
  description?: string;
  /** Sheets the page shows. */
  sheets: number;
  /** Cells with a formula the page shows. */
  formulas: number;
  /** `sheet:truncated`, `sheet:charts`, `sheet:images`, sorted. */
  warnings: string[];
}

function text(value: string): PhrasingContent {
  return { type: 'text', value };
}

function cellContent(cell: SheetCell | undefined): PhrasingContent[] {
  if (!cell || !cell.text) {
    return [];
  }
  return cell.link
    ? [{ type: 'link', url: cell.link, children: [text(cell.text)] }]
    : [text(cell.text)];
}

function paragraph(children: PhrasingContent[]): Paragraph {
  return { type: 'paragraph', children };
}

function heading(depth: 2 | 3, value: string): Heading {
  return { type: 'heading', depth, children: [text(value)] };
}

function list(items: PhrasingContent[][]): List {
  return {
    type: 'list',
    ordered: false,
    spread: false,
    children: items.map((children): ListItem => ({
      type: 'listItem',
      spread: false,
      children: [paragraph(children)],
    })),
  };
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** The words of a list: `a`, `a and b`, `a, b and c`. */
function series(values: readonly string[]): string {
  if (values.length <= 1) {
    return values[0] ?? '';
  }
  return `${values.slice(0, -1).join(', ')} and ${values.at(-1) ?? ''}`;
}

/** The rows of a block, each the cells shown across its columns. */
function blockRows(
  grid: SheetGrid,
  range: CellRange,
): Array<Array<SheetCell | undefined>> {
  const rows: Array<Array<SheetCell | undefined>> = [];
  for (let row = range.top; row <= range.bottom; row += 1) {
    const cells: Array<SheetCell | undefined> = [];
    for (let column = range.left; column <= range.right; column += 1) {
      cells.push(grid.shown(row, column));
    }
    if (cells.some((cell) => cell !== undefined)) {
      rows.push(cells);
    }
  }
  return rows;
}

/**
 * A block of two columns that reads as labels and their values, as a form
 * does: every row starts with text, and the first row's value is not text, so
 * it is no header.
 */
function isLabelValueBlock(
  rows: ReadonlyArray<ReadonlyArray<SheetCell | undefined>>,
): boolean {
  return (
    rows.length >= 2 &&
    rows.every((row) => row.length === 2 && row[0]?.kind === 'text') &&
    rows[0]?.[1] !== undefined &&
    rows[0][1].kind !== 'text'
  );
}

function tableOf(
  rows: ReadonlyArray<ReadonlyArray<SheetCell | undefined>>,
): Table {
  const width = Math.max(...rows.map((row) => row.length));
  const align = Array.from({ length: width }, (_, column) => {
    const body = rows
      .slice(1)
      .map((row) => row[column])
      .filter((cell) => cell !== undefined);
    return body.length > 0 && body.every((cell) => cell.kind === 'number')
      ? ('right' as const)
      : null;
  });
  return {
    type: 'table',
    align,
    children: rows.map((row): TableRow => ({
      type: 'tableRow',
      children: Array.from({ length: width }, (_, column): TableCell => ({
        type: 'tableCell',
        children: cellContent(row[column]),
      })),
    })),
  };
}

interface SheetContext {
  grid: SheetGrid;
  labels: Map<number, CellLabel>;
  depth: 2 | 3;
  /** The page's title, which a caption does not repeat. */
  title: string;
  /** The header row of the first table, for a one-sheet description. */
  firstHeader?: string[];
  /** The first text the sheet shows, for a description. */
  firstText?: string;
}

/** A block's content, with any caption above it. */
function renderBlock(block: SheetBlock, context: SheetContext): RootContent[] {
  const { grid } = context;
  const { range } = block;
  const firstRow = block.areas.filter((area) => area.range.top === range.top);
  const caption = firstRow.length === 1 ? firstRow[0] : undefined;
  if (
    caption &&
    block.areas.length > 1 &&
    caption.cell.kind === 'text' &&
    range.bottom > caption.range.bottom
  ) {
    const repeatsTitle =
      caption.cell.text.toLocaleLowerCase('en') ===
      context.title.toLocaleLowerCase('en');
    if (!repeatsTitle) {
      context.firstText ??= caption.cell.text;
    }
    return [
      ...(repeatsTitle ? [] : [heading(context.depth, caption.cell.text)]),
      ...cutIntoBlocks(block.areas.filter((area) => area !== caption)).flatMap(
        (inner) => renderBlock(inner, context),
      ),
    ];
  }

  labelBlock(grid, range, context.labels);
  // Each value once, as a list or a line shows it; a table repeats merges.
  const anchors = block.areas.map((area) => area.cell);
  const firstText = anchors.find((cell) => cell.kind === 'text')?.text;
  if (firstText !== undefined) {
    context.firstText ??= firstText;
  }
  if (anchors.length === 1 && anchors[0]) {
    return [paragraph(cellContent(anchors[0]))];
  }
  if (range.left === range.right) {
    return [list(anchors.map((cell) => cellContent(cell)))];
  }
  if (range.top === range.bottom) {
    return [
      paragraph(
        anchors.flatMap((cell, index) => [
          ...(index > 0 ? [text(' · ')] : []),
          ...cellContent(cell),
        ]),
      ),
    ];
  }
  const rows = blockRows(grid, range);
  if (isLabelValueBlock(rows)) {
    return [
      list(
        rows.map((row) => [
          {
            type: 'strong',
            children: [
              text(`${(row[0]?.text ?? '').replace(/[\s:：]+$/u, '')}:`),
            ],
          },
          text(' '),
          ...cellContent(row[1]),
        ]),
      ),
    ];
  }
  context.firstHeader ??= (rows[0] ?? [])
    .map((cell) => cell?.text ?? '')
    .filter((value) => value !== '');
  return [tableOf(rows)];
}

/** Where every formula of the workbook points, to find inputs and results. */
interface ReferenceIndex {
  /** Cells a formula names on their own, by sheet. */
  single: Map<string, Set<number>>;
  /** Ranges a formula names, by sheet. */
  ranges: Map<string, CellRange[]>;
}

/** The workbook's defined names, by the case-insensitive key Excel uses. */
type NameTable = ReadonlyMap<string, WorkbookData['names'][number]>;

function nameTable(workbook: WorkbookData): NameTable {
  return new Map(
    workbook.names.map((name) => [name.name.toLocaleLowerCase('en'), name]),
  );
}

/** The defined names a formula uses, each once, in the order it uses them. */
function namesUsed(formula: string, names: NameTable): WorkbookData['names'] {
  if (names.size === 0) {
    return [];
  }
  const used = new Set<WorkbookData['names'][number]>();
  for (const word of formulaIdentifiers(formula)) {
    const name = names.get(word.toLocaleLowerCase('en'));
    if (name) {
      used.add(name);
    }
  }
  return [...used];
}

function indexReferences(
  workbook: WorkbookData,
  names: NameTable,
): ReferenceIndex {
  const single = new Map<string, Set<number>>();
  const ranges = new Map<string, Map<string, CellRange>>();
  const add = (sheet: string, range: CellRange) => {
    if (range.top === range.bottom && range.left === range.right) {
      const cells = single.get(sheet) ?? new Set<number>();
      cells.add(cellKey(range.top, range.left));
      single.set(sheet, cells);
      return;
    }
    const known = ranges.get(sheet) ?? new Map<string, CellRange>();
    known.set(rangeAddress(range), range);
    ranges.set(sheet, known);
  };
  for (const sheet of workbook.sheets) {
    for (const cell of sheet.cells) {
      if (cell.formula === undefined) {
        continue;
      }
      for (const reference of formulaReferences(cell.formula)) {
        if (!reference.external) {
          add(reference.sheet ?? sheet.name, reference.range);
        }
      }
      for (const name of namesUsed(cell.formula, names)) {
        add(name.sheet, name.range);
      }
    }
  }
  return {
    single,
    ranges: new Map(
      [...ranges].map(([sheet, known]) => [sheet, [...known.values()]]),
    ),
  };
}

/** Formula cells some other formula refers to, alone or within a range. */
function referencedFormulaCells(
  sheet: WorkbookData['sheets'][number],
  index: ReferenceIndex,
): Set<number> {
  const referenced = new Set(index.single.get(sheet.name) ?? []);
  const byRow = new Map<number, SheetCell[]>();
  for (const cell of sheet.cells) {
    if (cell.formula !== undefined) {
      byRow.set(cell.row, [...(byRow.get(cell.row) ?? []), cell]);
    }
  }
  const rows = [...byRow.keys()];
  for (const range of index.ranges.get(sheet.name) ?? []) {
    for (const row of rows) {
      if (row < range.top || row > range.bottom) {
        continue;
      }
      for (const cell of byRow.get(row) ?? []) {
        if (cell.column >= range.left && cell.column <= range.right) {
          referenced.add(cellKey(cell.row, cell.column));
        }
      }
    }
  }
  return referenced;
}

/** Cells that share a formula's shape and sit together, as one rectangle. */
interface FormulaGroup {
  range: CellRange;
  first: SheetCell;
  cells: SheetCell[];
}

function groupFormulas(cells: readonly SheetCell[]): FormulaGroup[] {
  const runs: Array<FormulaGroup & { shape: string }> = [];
  for (const cell of cells) {
    if (cell.formula === undefined) {
      continue;
    }
    const shape = formulaShape(cell.formula, cell.row, cell.column);
    const last = runs.at(-1);
    if (
      last &&
      last.shape === shape &&
      last.range.top === cell.row &&
      last.range.right === cell.column - 1
    ) {
      last.range.right = cell.column;
      last.cells.push(cell);
      continue;
    }
    runs.push({
      shape,
      first: cell,
      cells: [cell],
      range: {
        top: cell.row,
        left: cell.column,
        bottom: cell.row,
        right: cell.column,
      },
    });
  }
  const groups: Array<FormulaGroup & { shape: string }> = [];
  const open = new Map<string, FormulaGroup & { shape: string }>();
  for (const run of runs) {
    const key = `${run.range.left}:${run.range.right}:${run.shape}`;
    const above = open.get(key);
    if (above && above.range.bottom === run.range.top - 1) {
      above.range.bottom = run.range.top;
      above.cells.push(...run.cells);
      continue;
    }
    open.set(key, run);
    groups.push(run);
  }
  return groups.sort(
    (left, right) =>
      left.range.top - right.range.top || left.range.left - right.range.left,
  );
}

interface Namer {
  /** A cell's full label, `Revenue, Mar`, or a name the workbook defines. */
  cell(sheet: string, row: number, column: number): string | undefined;
  /** One part of a cell's label. */
  part(
    sheet: string,
    row: number,
    column: number,
    part: 'row' | 'column',
  ): string | undefined;
  /** A range's label: the name it is defined as, or its column or row. */
  range(sheet: string, range: CellRange): string | undefined;
  /** The defined names a formula uses, each with the cells it stands for. */
  namesIn(formula: string, sheet: string): Array<[string, string]>;
  /** The sheets the workbook hides, which the page never names. */
  hiddenSheets: ReadonlySet<string>;
}

function createNamer(
  workbook: WorkbookData,
  names: NameTable,
  labels: ReadonlyMap<string, ReadonlyMap<number, CellLabel>>,
): Namer {
  const defined = new Map(
    workbook.names.map((name) => [
      `${name.sheet}!${rangeAddress(name.range)}`,
      name.name,
    ]),
  );
  const label = (sheet: string, row: number, column: number) =>
    labels.get(sheet)?.get(cellKey(row, column));
  return {
    hiddenSheets: new Set(workbook.hiddenSheets),
    cell(sheet, row, column) {
      const name = defined.get(
        `${sheet}!${rangeAddress({ top: row, left: column, bottom: row, right: column })}`,
      );
      if (name) {
        return name;
      }
      const found = label(sheet, row, column);
      const parts = [found?.row, found?.column].filter(
        (part) => part !== undefined,
      );
      return parts.length > 0 ? parts.join(', ') : undefined;
    },
    part(sheet, row, column, part) {
      return label(sheet, row, column)?.[part];
    },
    namesIn(formula, sheet) {
      return namesUsed(formula, names).map((name) => [
        name.name,
        `${name.sheet === sheet ? '' : `${name.sheet} › `}${rangeAddress(name.range)}`,
      ]);
    },
    range(sheet, range) {
      const name = defined.get(`${sheet}!${rangeAddress(range)}`);
      if (name) {
        return name;
      }
      if (range.left === range.right) {
        return label(sheet, range.bottom, range.left)?.column;
      }
      if (range.top === range.bottom) {
        return label(sheet, range.top, range.right)?.row;
      }
      return undefined;
    },
  };
}

/**
 * A formula as the page quotes it: with `=`, cut when very long, and with the
 * name of any hidden sheet it refers to replaced, since hiding a sheet keeps
 * it off the site.
 */
function quoteFormula(formula: string, hidden: ReadonlySet<string>): string {
  let shown = formula;
  if (hidden.size > 0) {
    shown = '';
    let position = 0;
    for (const reference of formulaReferences(formula)) {
      if (reference.sheet === undefined || !hidden.has(reference.sheet)) {
        continue;
      }
      shown += `${formula.slice(position, reference.start)}${HIDDEN_SHEET}!`;
      position = reference.start + reference.prefix.length;
    }
    shown += formula.slice(position);
  }
  const quoted = `=${shown}`;
  return quoted.length > MAX_FORMULA_CHARACTERS
    ? `${quoted.slice(0, MAX_FORMULA_CHARACTERS - 1)}…`
    : quoted;
}

/** What one reference in a group's formula is called, if anything. */
function referenceLabel(
  reference: FormulaReference,
  group: FormulaGroup,
  sheet: string,
  namer: Namer,
): string | undefined {
  if (reference.external || reference.whole) {
    return undefined;
  }
  const target = reference.sheet ?? sheet;
  const { range } = reference;
  let label: string | undefined;
  const down = group.range.bottom > group.range.top;
  const across = group.range.right > group.range.left;
  if (range.top !== range.bottom || range.left !== range.right) {
    /*
     * A range that moves with the group, as `B2:X2` does down a column of
     * row totals, is not named by the row or column it starts in.
     */
    const [fixedTop, fixedLeft] = reference.fixed;
    const moves =
      (range.top === range.bottom && down && !fixedTop) ||
      (range.left === range.right && across && !fixedLeft);
    label = moves ? undefined : namer.range(target, range);
  } else {
    const [fixedRow, fixedColumn] = reference.fixed;
    label =
      (down && !fixedRow
        ? namer.part(target, range.top, range.left, 'column')
        : across && !fixedColumn
          ? namer.part(target, range.top, range.left, 'row')
          : undefined) ?? namer.cell(target, range.top, range.left);
  }
  return label === undefined
    ? undefined
    : reference.sheet !== undefined && reference.sheet !== sheet
      ? `${reference.sheet} › ${label}`
      : label;
}

function groupLabel(
  group: FormulaGroup,
  sheet: string,
  namer: Namer,
): string | undefined {
  const { top, left, bottom, right } = group.range;
  if (top === bottom && left === right) {
    return namer.cell(sheet, top, left);
  }
  if (top === bottom) {
    return (
      namer.part(sheet, top, left, 'row') ??
      namer.part(sheet, top, left, 'column')
    );
  }
  return (
    namer.part(sheet, top, left, 'column') ??
    namer.part(sheet, top, left, 'row')
  );
}

function formulaItem(
  group: FormulaGroup,
  sheet: string,
  namer: Namer,
): PhrasingContent[] {
  const formula = group.first.formula ?? '';
  const label = groupLabel(group, sheet, namer);
  const named = new Map<string, string>();
  for (const reference of formulaReferences(formula)) {
    if (
      reference.sheet !== undefined &&
      namer.hiddenSheets.has(reference.sheet)
    ) {
      continue;
    }
    const written = formula.slice(reference.start, reference.end);
    const referenceName = referenceLabel(reference, group, sheet, namer);
    if (referenceName !== undefined && !named.has(written)) {
      named.set(written, referenceName);
    }
  }
  for (const [name, cells] of namer.namesIn(formula, sheet)) {
    named.set(name, cells);
  }
  return [
    ...(label
      ? [
          { type: 'strong', children: [text(label)] } satisfies PhrasingContent,
          text(' ('),
        ]
      : []),
    { type: 'inlineCode', value: rangeAddress(group.range) },
    text(label ? '): ' : ': '),
    { type: 'inlineCode', value: quoteFormula(formula, namer.hiddenSheets) },
    ...(named.size > 0
      ? [
          text(', where '),
          ...[...named].flatMap(([written, name], index): PhrasingContent[] => [
            ...(index === 0
              ? []
              : [text(index === named.size - 1 ? ' and ' : ', ')]),
            { type: 'inlineCode', value: written },
            text(` is ${name}`),
          ]),
        ]
      : []),
  ];
}

function valueItem(
  cell: SheetCell,
  sheet: string,
  namer: Namer,
): PhrasingContent[] {
  const label = namer.cell(sheet, cell.row, cell.column);
  const address = rangeAddress({
    top: cell.row,
    left: cell.column,
    bottom: cell.row,
    right: cell.column,
  });
  return [
    ...(label
      ? [
          { type: 'strong', children: [text(label)] } satisfies PhrasingContent,
          text(' ('),
        ]
      : []),
    { type: 'inlineCode', value: address },
    text(label ? '): ' : ': '),
    ...(cell.text ? cellContent(cell) : [text('empty')]),
  ];
}

function groupResultItem(
  group: FormulaGroup,
  sheet: string,
  namer: Namer,
): PhrasingContent[] {
  const label = groupLabel(group, sheet, namer);
  const { top, left, bottom, right } = group.range;
  const each = top === bottom ? 'column' : left === right ? 'row' : 'cell';
  return [
    ...(label
      ? [
          { type: 'strong', children: [text(label)] } satisfies PhrasingContent,
          text(' ('),
        ]
      : []),
    { type: 'inlineCode', value: rangeAddress(group.range) },
    text(`${label ? ')' : ''}: one for each ${each}, in the table above`),
  ];
}

function capped(
  title: string,
  items: PhrasingContent[][],
  limit: number,
  rest: (count: number) => string,
): RootContent[] {
  if (items.length === 0) {
    return [];
  }
  return [
    paragraph([{ type: 'strong', children: [text(title)] }]),
    list(items.slice(0, limit)),
    ...(items.length > limit
      ? [paragraph([text(rest(items.length - limit))])]
      : []),
  ];
}

/** How a sheet calculates, when it has formulas. */
function calculations(
  sheet: WorkbookData['sheets'][number],
  index: ReferenceIndex,
  namer: Namer,
  depth: 2 | 3,
): RootContent[] {
  const formulaCells = sheet.cells.filter((cell) => cell.formula !== undefined);
  if (formulaCells.length === 0) {
    return [];
  }
  const groups = groupFormulas(formulaCells);
  const referencedSingles = index.single.get(sheet.name) ?? new Set<number>();
  const inputs = sheet.cells.filter(
    (cell) =>
      cell.formula === undefined &&
      cell.kind !== 'empty' &&
      referencedSingles.has(cellKey(cell.row, cell.column)),
  );
  const referenced = referencedFormulaCells(sheet, index);
  /*
   * A result is a formula cell nothing else uses. A whole group of them, as a
   * column of row totals is, is one entry rather than one per row.
   */
  const results: PhrasingContent[][] = [];
  for (const group of groups) {
    const unused = group.cells.filter(
      (cell) => !referenced.has(cellKey(cell.row, cell.column)),
    );
    if (unused.length > 1 && unused.length === group.cells.length) {
      results.push(groupResultItem(group, sheet.name, namer));
      continue;
    }
    for (const cell of unused) {
      results.push(valueItem(cell, sheet.name, namer));
    }
  }
  return [
    heading(depth, 'How it is calculated'),
    ...capped(
      'Formulas',
      groups.map((group) => formulaItem(group, sheet.name, namer)),
      MAX_FORMULAS,
      (count) => `And ${plural(count, 'more formula')}, in the spreadsheet.`,
    ),
    ...capped(
      'Inputs',
      inputs.map((cell) => valueItem(cell, sheet.name, namer)),
      MAX_INPUTS,
      (count) => `And ${plural(count, 'more input')}, in the tables above.`,
    ),
    ...capped(
      'Results',
      results,
      MAX_RESULTS,
      (count) => `And ${plural(count, 'more result')}, in the tables above.`,
    ),
  ];
}

function emphasis(value: string): Paragraph {
  return paragraph([{ type: 'emphasis', children: [text(value)] }]);
}

function notShown(charts: number, images: number): string | undefined {
  const parts = [
    ...(charts > 0 ? [plural(charts, 'chart')] : []),
    ...(images > 0 ? [plural(images, 'image')] : []),
  ];
  return parts.length > 0
    ? `This sheet has ${series(parts)} the site does not show. Open the spreadsheet to see ${charts + images === 1 ? 'it' : 'them'}.`
    : undefined;
}

/** The page of a workbook: its sheets, their tables and their calculations. */
export function workbookToMarkdown(
  workbook: WorkbookData,
  title: string,
): SheetMarkdown {
  const { omittedSheets } = workbook;
  const single = workbook.sheets.length === 1;
  const depth = single ? 2 : 3;
  const labels = new Map<string, Map<number, CellLabel>>();
  const rendered: Array<{ name: string; content: RootContent[] }> = [];
  const warnings = new Set<string>();
  let firstHeader: string[] | undefined;
  let firstText: string | undefined;
  for (const sheet of workbook.sheets) {
    const grid = new SheetGrid(sheet);
    const sheetLabels = new Map<number, CellLabel>();
    labels.set(sheet.name, sheetLabels);
    const context: SheetContext = {
      grid,
      labels: sheetLabels,
      depth,
      title,
    };
    const content = cutIntoBlocks(grid.areas).flatMap((block) =>
      renderBlock(block, context),
    );
    firstHeader ??= context.firstHeader;
    firstText ??= context.firstText;
    rendered.push({ name: sheet.name, content });
    if (sheet.charts > 0) {
      warnings.add('sheet:charts');
    }
    if (sheet.images > 0) {
      warnings.add('sheet:images');
    }
    if (sheet.truncatedAfterRow !== undefined) {
      warnings.add('sheet:truncated');
    }
  }
  if (workbook.chartSheets > 0) {
    warnings.add('sheet:charts');
  }
  if (omittedSheets > 0) {
    warnings.add('sheet:truncated');
  }

  const definedNames = nameTable(workbook);
  const index = indexReferences(workbook, definedNames);
  const namer = createNamer(workbook, definedNames, labels);
  const tree: Root = { type: 'root', children: [] };
  for (const [position, sheet] of workbook.sheets.entries()) {
    const { content } = rendered[position] ?? { content: [] };
    const extra = [
      ...calculations(sheet, index, namer, depth),
      ...(sheet.truncatedAfterRow === undefined
        ? []
        : [
            emphasis(
              sheet.truncatedAfterRow === 0
                ? 'The site does not show this sheet: the spreadsheet is longer than the site publishes. Open the spreadsheet to read it.'
                : `The site shows this sheet up to row ${sheet.truncatedAfterRow}. Open the spreadsheet for the rest.`,
            ),
          ]),
      ...(() => {
        const note = notShown(sheet.charts, sheet.images);
        return note ? [emphasis(note)] : [];
      })(),
    ];
    if (content.length === 0 && extra.length === 0) {
      continue;
    }
    if (!single) {
      tree.children.push(heading(2, sheet.name || `Sheet ${position + 1}`));
    }
    tree.children.push(...content, ...extra);
  }
  const leftOut = [
    ...(workbook.chartSheets > 0
      ? [
          `${plural(workbook.chartSheets, 'chart')} on ${workbook.chartSheets === 1 ? 'a sheet of its own' : 'sheets of their own'}`,
        ]
      : []),
    ...(omittedSheets > 0 ? [plural(omittedSheets, 'more sheet')] : []),
  ];
  if (leftOut.length > 0) {
    tree.children.push(
      emphasis(
        `The spreadsheet also has ${series(leftOut)}, which the site does not show.`,
      ),
    );
  }

  const names = workbook.sheets.map((sheet) => sheet.name).filter(Boolean);
  const description = !single
    ? `A spreadsheet with the sheets ${series(names.length > 6 ? [...names.slice(0, 5), plural(names.length - 5, 'more')] : names)}.`
    : firstHeader && firstHeader.length > 0
      ? `A spreadsheet with the columns ${series(firstHeader.length > 8 ? [...firstHeader.slice(0, 7), plural(firstHeader.length - 7, 'more')] : firstHeader)}.`
      : firstText &&
          firstText.toLocaleLowerCase('en') !== title.toLocaleLowerCase('en')
        ? firstText
        : undefined;

  return {
    body:
      tree.children.length > 0
        ? `${markdownProcessor.stringify(tree).trimEnd()}\n`
        : '',
    ...(description ? { description: truncateDescription(description) } : {}),
    sheets: workbook.sheets.length,
    formulas: workbook.sheets.reduce(
      (count, sheet) =>
        count + sheet.cells.filter((cell) => cell.formula !== undefined).length,
      0,
    ),
    warnings: [...warnings].sort(),
  };
}

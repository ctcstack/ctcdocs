/**
 * How a spreadsheet's page reads and orders the values in its cells
 * (ADR-046), apart from the element that uses it so that it can be tested
 * without a browser.
 */

/**
 * A cell's value as a number, the way a spreadsheet shows one: currency
 * symbols, grouping commas and spaces dropped, a percent sign kept as the
 * same number, and parentheses read as a minus. `undefined` for anything that
 * is not a number.
 */
export function numericValue(text: string): number | undefined {
  let value = text.trim();
  if (!value) return undefined;
  let negative = false;
  if (/^\(.*\)$/u.test(value)) {
    negative = true;
    value = value.slice(1, -1);
  }
  value = value.replace(/[\s,$€£¥₽%]/gu, '');
  if (!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/iu.test(value)) {
    return undefined;
  }
  const number = Number(value);
  return Number.isFinite(number) ? (negative ? -number : number) : undefined;
}

/**
 * Orders two cells: numbers by value and before text, text in the reader's
 * language, and empty cells last whichever way the column is sorted.
 */
export function compareCells(
  left: string,
  right: string,
  direction: 1 | -1,
): number {
  const a = left.trim();
  const b = right.trim();
  if (!a || !b) return a === b ? 0 : a ? -1 : 1;
  const x = numericValue(a);
  const y = numericValue(b);
  if (x !== undefined && y !== undefined) return (x - y) * direction;
  if (x !== undefined) return -1 * direction;
  if (y !== undefined) return direction;
  return (
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }) *
    direction
  );
}

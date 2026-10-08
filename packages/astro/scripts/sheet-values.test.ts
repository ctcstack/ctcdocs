import { describe, expect, it } from 'vitest';

import { compareCells, numericValue } from './sheet-values';

describe('numericValue', () => {
  it.each([
    ['1,234.50', 1234.5],
    ['$5,000', 5000],
    ['15%', 15],
    ['(3)', -3],
    ['-0.5', -0.5],
    ['1.2E+04', 12_000],
  ])('%s → %d', (text, value) => {
    expect(numericValue(text)).toBe(value);
  });

  it.each(['', 'Pro', '12 apples', '2026-03-15'])('%s is no number', (text) => {
    expect(numericValue(text)).toBeUndefined();
  });
});

describe('compareCells', () => {
  const sorted = (values: string[], direction: 1 | -1) =>
    [...values].sort((left, right) => compareCells(left, right, direction));

  it('sorts numbers by value, before text, and empty cells last', () => {
    expect(sorted(['10', 'b', '', '9', 'A', '$1,000'], 1)).toEqual([
      '9',
      '10',
      '$1,000',
      'A',
      'b',
      '',
    ]);
    expect(sorted(['10', 'b', '', '9', 'A'], -1)).toEqual([
      'b',
      'A',
      '10',
      '9',
      '',
    ]);
  });
});

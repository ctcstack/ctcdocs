import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  cellAddress,
  columnIndex,
  columnLetters,
  formulaReferences,
  formulaShape,
  parseRangeAddress,
  rangeAddress,
  shiftFormula,
} from './formula.js';

function written(formula: string): string[] {
  return formulaReferences(formula).map((reference) =>
    formula.slice(reference.start, reference.end),
  );
}

describe('column letters', () => {
  it('round-trips every column a workbook can have', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 16_383 }), (index) => {
        expect(columnIndex(columnLetters(index))).toBe(index);
      }),
    );
    expect(columnLetters(0)).toBe('A');
    expect(columnLetters(26)).toBe('AA');
    expect(columnLetters(16_383)).toBe('XFD');
  });

  it('writes and reads addresses', () => {
    expect(cellAddress(4, 1)).toBe('B5');
    expect(parseRangeAddress('$B$5:A1')).toEqual({
      top: 0,
      left: 0,
      bottom: 4,
      right: 1,
    });
    expect(rangeAddress({ top: 4, left: 1, bottom: 4, right: 12 })).toBe(
      'B5:M5',
    );
    expect(parseRangeAddress('XFE1')).toBeUndefined();
  });
});

describe('formulaReferences', () => {
  it('finds cells, ranges, whole columns and rows', () => {
    expect(written('SUM(B2:B10)*$C$1+D:D-3:4')).toEqual([
      'B2:B10',
      '$C$1',
      'D:D',
      '3:4',
    ]);
  });

  it('reads the sheet a reference names, quoted or not', () => {
    const references = formulaReferences("Plan!B2+'Plan ''A'''!C3+[1]Other!D4");
    expect(references.map((reference) => reference.sheet)).toEqual([
      'Plan',
      "Plan 'A'",
      'Other',
    ]);
    expect(references.map((reference) => reference.external)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it('leaves out function names, defined names and strings', () => {
    expect(written('LOG10(A1)+Rate2024_x+Q1_sales')).toEqual(['A1']);
    expect(written('IF(A1="B2",C3,"D4 ""E5""")')).toEqual(['A1', 'C3']);
  });

  it('records which edges are fixed', () => {
    expect(formulaReferences('$A1:B$2')[0]?.fixed).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });
});

describe('shiftFormula', () => {
  it('moves what is not fixed, as filling a formula does', () => {
    expect(shiftFormula('B3/B4*$B$6+B$1+$A5', 0, 2)).toBe('D3/D4*$B$6+D$1+$A5');
    expect(shiftFormula('SUM(B2:B10)', 1, 0)).toBe('SUM(B3:B11)');
    expect(shiftFormula('Plan!B2+C:C', 0, 1)).toBe('Plan!C2+D:D');
  });

  it('writes #REF! where a reference would leave the sheet', () => {
    expect(shiftFormula('A2*2', -5, 0)).toBe('#REF!*2');
  });

  it('leaves text in quotes alone', () => {
    expect(shiftFormula('"A1"&A1', 0, 1)).toBe('"A1"&B1');
  });
});

describe('formulaShape', () => {
  it('is the same for formulas that differ only by their offset', () => {
    expect(formulaShape('B3/B4', 4, 1)).toBe(formulaShape('D3/D4', 4, 3));
    expect(formulaShape('B3*$B$6', 4, 1)).toBe(formulaShape('C3*$B$6', 4, 2));
    expect(formulaShape('B3/B4', 4, 1)).not.toBe(formulaShape('B3/B5', 4, 1));
    expect(formulaShape('$B3', 4, 1)).not.toBe(formulaShape('$C3', 4, 2));
  });
});

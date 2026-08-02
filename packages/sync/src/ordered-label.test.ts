import { describe, expect, it } from 'vitest';

import {
  hasUnrecognizedOrderPrefix,
  parseOrderedLabel,
} from './ordered-label.js';

describe('ordered labels', () => {
  it.each([
    ['01 - Company', 1, 'Company'],
    ['01 – Company', 1, 'Company'],
    ['01 — Company', 1, 'Company'],
    ['01. Company', 1, 'Company'],
    ['1-Company', 1, 'Company'],
    ['[1] Company', 1, 'Company'],
    ['[002] Company', 2, 'Company'],
    ['[7]Company', 7, 'Company'],
    ['013 — Company', 13, 'Company'],
  ])('reads the order out of %s', (input, order, label) => {
    expect(parseOrderedLabel(input)).toEqual({ order, label });
  });

  it.each([
    ['10 Engineering', '10 Engineering'],
    ['2024 Annual Report', '2024 Annual Report'],
    ['1234 - Quarterly Plan', '1234 - Quarterly Plan'],
    ['24/7 Support', '24/7 Support'],
    ['No order', 'No order'],
  ])('keeps %s intact', (input, label) => {
    expect(parseOrderedLabel(input)).toEqual({ order: null, label });
  });

  it('falls back to a placeholder for an empty name', () => {
    expect(parseOrderedLabel('  ')).toEqual({ order: null, label: 'Untitled' });
    expect(parseOrderedLabel('01 - ')).toEqual({ order: 1, label: 'Untitled' });
  });

  it.each([['01 Company'], ['1 Company'], ['013 Company'], ['07']])(
    'reports %s as an order prefix the grammar does not accept',
    (input) => {
      expect(hasUnrecognizedOrderPrefix(input)).toBe(true);
    },
  );

  it.each([
    ['01 - Company'],
    ['[01] Company'],
    ['2024 Annual Report'],
    ['24/7 Support'],
    ['No order'],
  ])('does not report %s as an attempted order prefix', (input) => {
    expect(hasUnrecognizedOrderPrefix(input)).toBe(false);
  });
});

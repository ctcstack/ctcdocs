import { describe, expect, it } from 'vitest';

import { FILTER_VALUES, searchFilter } from './search-filter.js';

/** Class IDs as the build writes them: eight hexadecimal characters. */
const classes = (count: number, from = 0) =>
  Array.from({ length: count }, (_, n) =>
    (from + n).toString(16).padStart(8, '0'),
  );
const ids = (count: number) =>
  Array.from({ length: count }, (_, n) => n.toString(16).padStart(6, 'a'));
const size = (filter: object) =>
  new TextEncoder().encode(JSON.stringify(filter)).length;

describe('the filter a search sends', () => {
  it('names the reader’s classes, and the narrowed documents', () => {
    expect(searchFilter(['members', 'team'], ['members'])).toEqual({
      class: { $in: ['members'] },
    });
    expect(
      searchFilter(['members', 'team'], ['members'], { in: ['aaaaaa'] }),
    ).toEqual({ class: { $in: ['members'] }, short_id: { $in: ['aaaaaa'] } });
    expect(
      searchFilter(['members'], ['members'], { notIn: ['bbbbbb'] }),
    ).toEqual({ class: { $in: ['members'] }, short_id: { $nin: ['bbbbbb'] } });
  });

  it('keeps every value list within what keyword search takes', () => {
    // More readable classes than keyword search takes, few others: those.
    const all = classes(FILTER_VALUES + 5);
    const readable = all.slice(0, FILTER_VALUES + 2);
    expect(searchFilter(all, readable)).toEqual({
      class: { $nin: all.slice(FILTER_VALUES + 2) },
    });
    // Every class the reader's: no class filter at all.
    expect(searchFilter(readable, readable)).toEqual({});
  });

  it('keeps the reader’s classes when neither side fits', () => {
    const all = classes(2 * FILTER_VALUES + 2);
    const readable = all.slice(0, FILTER_VALUES + 1);
    expect(searchFilter(all, readable)).toEqual({ class: { $in: readable } });
  });

  it('drops the narrowing first, then the classes, to stay under 2,048 bytes', () => {
    // 160 readable classes of 240: the class filter alone fits.
    const all = classes(240);
    const readable = all.slice(0, 160);
    const narrowed = searchFilter(all, readable, { in: ids(FILTER_VALUES) });
    expect(narrowed).toEqual({ class: { $in: readable } });
    expect(size(narrowed)).toBeLessThan(2048);
    // 300 readable of 400: not even the classes fit.
    const many = classes(400);
    expect(searchFilter(many, many.slice(0, 300))).toEqual({});
  });

  it('never sends a list longer than keyword search takes, or a filter too large', () => {
    for (const total of [1, 10, 40, 41, 80, 82, 200, 400]) {
      for (const readableCount of [1, 20, 40, 41, 81, 200, 300]) {
        if (readableCount > total) {
          continue;
        }
        const all = classes(total);
        const filter = searchFilter(all, all.slice(0, readableCount), {
          in: ids(FILTER_VALUES),
        });
        expect(size(filter)).toBeLessThan(2048);
        for (const condition of Object.values(filter)) {
          for (const values of Object.values(condition)) {
            const tooMany = values.length > FILTER_VALUES;
            // Only the reader's classes may run past it, when nothing else fits.
            expect(
              !tooMany ||
                (values === filter.class?.$in && readableCount > FILTER_VALUES),
            ).toBe(true);
          }
        }
      }
    }
  });
});

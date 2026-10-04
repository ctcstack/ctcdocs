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
      searchFilter(['members', 'team'], ['members'], { notIn: ['bbbbbb'] }),
    ).toEqual({ class: { $in: ['members'] }, short_id: { $nin: ['bbbbbb'] } });
    // A reader of every class needs no class filter.
    expect(searchFilter(['members'], ['members'], { in: ['aaaaaa'] })).toEqual({
      short_id: { $in: ['aaaaaa'] },
    });
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

  it('gives keyword search way to a side a search takes at all, when neither fits forty', () => {
    const readableFirst = classes(2 * FILTER_VALUES + 2);
    const readable = readableFirst.slice(0, FILTER_VALUES + 1);
    expect(searchFilter(readableFirst, readable)).toEqual({
      class: { $in: readable },
    });
    // More than a hundred readable, a hundred or fewer others: those.
    const all = classes(180);
    expect(searchFilter(all, all.slice(0, 101))).toEqual({
      class: { $nin: all.slice(101) },
    });
  });

  it('sends no class filter when both sides pass a hundred', () => {
    const all = classes(202);
    expect(searchFilter(all, all.slice(0, 101))).toEqual({});
    expect(
      searchFilter(all, all.slice(0, 101), { in: ids(FILTER_VALUES) }),
    ).toEqual({ short_id: { $in: ids(FILTER_VALUES) } });
  });

  it('drops the narrowing first, then the classes, to stay under 2,048 bytes', () => {
    // Class names longer than the build's: forty of them fill most of it.
    const long = (count: number, from = 0) =>
      classes(count, from).map((cls) => `${cls}-${'x'.repeat(30)}`);
    const all = [...long(40), ...long(40, 1000)];
    const readable = all.slice(0, 40);
    const narrowed = searchFilter(all, readable, { in: ids(FILTER_VALUES) });
    expect(narrowed).toEqual({ class: { $in: readable } });
    expect(size(narrowed)).toBeLessThan(2048);
    const longer = all.map((cls) => `${cls}${'y'.repeat(20)}`);
    expect(searchFilter(longer, longer.slice(0, 40))).toEqual({});
  });

  it('never sends a list a search fails on, or a filter too large', () => {
    for (const total of [1, 10, 40, 41, 80, 82, 100, 101, 180, 202, 400]) {
      for (const readableCount of [1, 20, 40, 41, 81, 100, 101, 200, 300]) {
        if (readableCount > total) {
          continue;
        }
        const all = classes(total);
        const others = total - readableCount;
        const filter = searchFilter(all, all.slice(0, readableCount), {
          in: ids(FILTER_VALUES),
        });
        expect(size(filter)).toBeLessThan(2048);
        for (const condition of Object.values(filter)) {
          for (const values of Object.values(condition)) {
            expect(values.length).toBeLessThanOrEqual(100);
            // Past forty only when neither side of the classes fits it.
            expect(
              values.length <= FILTER_VALUES ||
                (readableCount > FILTER_VALUES && others > FILTER_VALUES),
            ).toBe(true);
          }
        }
      }
    }
  });
});

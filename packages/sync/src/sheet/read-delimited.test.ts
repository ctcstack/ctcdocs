import { describe, expect, it } from 'vitest';

import { readDelimited } from './read-delimited.js';

function rows(text: string, tabs = false): string[][] {
  const sheet = readDelimited(new TextEncoder().encode(text), 'data', tabs)
    .sheets[0];
  const result: string[][] = [];
  for (const cell of sheet?.cells ?? []) {
    (result[cell.row] ??= [])[cell.column] = cell.text;
  }
  return result;
}

describe('readDelimited', () => {
  it('reads quoted fields with separators, quotes and line breaks', () => {
    expect(rows('﻿Name,Note\r\n"Smith, J","Said ""hi""\nthen left"\n')).toEqual(
      [
        ['Name', 'Note'],
        ['Smith, J', 'Said "hi" then left'],
      ],
    );
  });

  it('reads semicolons where the header has more of them than commas', () => {
    expect(rows('Item;Price\nTea;1,50\n')).toEqual([
      ['Item', 'Price'],
      ['Tea', '1,50'],
    ]);
  });

  it('reads tab-separated files', () => {
    expect(rows('a\tb\n1\t2', true)).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('tells numbers from text', () => {
    const sheet = readDelimited(
      new TextEncoder().encode('x,"$1,200.50",15%,(3),12 apples'),
      'data',
      false,
    ).sheets[0];
    expect(sheet?.cells.map((cell) => cell.kind)).toEqual([
      'text',
      'number',
      'number',
      'number',
      'text',
    ]);
  });

  it('reads UTF-16 with a byte order mark, and Windows-1251 that is not UTF-8', () => {
    const utf16 = new Uint8Array([
      0xff,
      0xfe,
      ...Buffer.from('Имя\tКод\n', 'utf16le'),
    ]);
    const fromUtf16 = readDelimited(utf16, 'data', true).sheets[0];
    expect(fromUtf16?.cells.map((cell) => cell.text)).toEqual(['Имя', 'Код']);
    const cp1251 = new Uint8Array([0xc8, 0xec, 0xff, 0x2c, 0x31]);
    const fromCp1251 = readDelimited(cp1251, 'data', false).sheets[0];
    expect(fromCp1251?.cells.map((cell) => cell.text)).toEqual(['Имя', '1']);
  });
});

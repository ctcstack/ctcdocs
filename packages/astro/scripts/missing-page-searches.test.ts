import { describe, expect, it } from 'vitest';

import { searchesFor } from './missing-page-searches.js';

describe('missing page searches', () => {
  it('searches for the page name before its single words', () => {
    expect(searchesFor('/pricing-2025/')).toEqual([
      'pricing 2025',
      'pricing',
      '2025',
    ]);
  });

  it('leaves the folders out while the name has words', () => {
    expect(
      searchesFor('/handbook/travel-desk/expense-policy--0a0b0c/'),
    ).toEqual(['expense policy', 'expense', 'policy']);
  });

  it('searches the folders when the name has no word', () => {
    expect(searchesFor('/handbook/travel-desk/q1/')).toEqual([
      'handbook travel desk',
      'handbook',
      'travel',
      'desk',
    ]);
  });

  it('drops short words and hexadecimal suffixes', () => {
    expect(searchesFor('/an-expense-policy--3f2a1c/')).toEqual([
      'expense policy',
      'expense',
      'policy',
    ]);
  });

  it('takes an index page by the name of its folders', () => {
    expect(searchesFor('/handbook/travel-desk/index.md')).toEqual([
      'handbook travel desk',
      'handbook',
      'travel',
      'desk',
    ]);
  });

  it('decodes a percent-encoded address', () => {
    expect(searchesFor(`/${encodeURIComponent('заметки-команды')}/`)).toEqual([
      'заметки команды',
      'заметки',
      'команды',
    ]);
  });

  it('searches an address that cannot be decoded as it is', () => {
    expect(searchesFor('/release-100%-done/')).toEqual([
      'release 100 done',
      'release',
      'done',
      '100',
    ]);
  });

  it('has nothing to search for in a permanent link or the home page', () => {
    expect(searchesFor('/d/3f2a1c/')).toEqual([]);
    expect(searchesFor('/')).toEqual([]);
  });
});

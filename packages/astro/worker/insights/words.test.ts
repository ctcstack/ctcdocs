import { describe, expect, it } from 'vitest';

import { queryWords, stopWordsFor } from './words.js';

describe('queryWords', () => {
  const english = stopWordsFor('en');
  const russian = stopWordsFor('ru-RU');

  it('keeps the words that say what is asked, once, sorted', () => {
    expect(
      queryWords('What is the Vacation policy, for vacation?', english),
    ).toEqual(['policy', 'vacation']);
    expect(queryWords('  PTO…  carry-over (2026)  ', english)).toEqual([
      '2026',
      'carry',
      'pto',
    ]);
  });

  it("drops English stop words always, and the documents' language's", () => {
    expect(queryWords('как оформить отпуск', russian)).toEqual([
      'отпуск',
      'оформить',
    ]);
    expect(queryWords('how to request a vacation', russian)).toEqual([
      'request',
      'vacation',
    ]);
    // Without a list for the language, its words all stay.
    expect(queryWords('как оформить отпуск', stopWordsFor('de'))).toEqual([
      'как',
      'отпуск',
      'оформить',
    ]);
  });

  it('keeps a question of stop words whole, and finds none in no words', () => {
    expect(queryWords('How to?', english)).toEqual(['how', 'to']);
    expect(queryWords(' ?!… ', english)).toEqual([]);
    expect(queryWords('', english)).toEqual([]);
  });

  it('reads compatibility forms as their plain letters', () => {
    expect(queryWords('ｖａｃａｔｉｏｎ', english)).toEqual(['vacation']);
  });
});

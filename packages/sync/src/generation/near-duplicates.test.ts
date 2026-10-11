import { describe, expect, it } from 'vitest';

import { findNearDuplicates, shingles } from './near-duplicates.js';

/** Deterministic prose of `count` words, different for each `seed`. */
function prose(seed: number, count: number): string {
  const syllables = [
    'ka',
    'lo',
    'mi',
    'ne',
    'ru',
    'sa',
    'to',
    'vi',
    'ze',
    'po',
  ];
  let state = seed * 2_654_435_761;
  const words: string[] = [];
  for (let index = 0; index < count; index += 1) {
    state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0;
    const word = [0, 1, 2]
      .map((shift) => syllables[(state >>> (shift * 4)) % syllables.length])
      .join('');
    words.push(word);
  }
  return words.join(' ');
}

describe('shingles', () => {
  it('reads the words and link targets, not the markup', () => {
    const plain = shingles('one two three four five six');
    const marked = shingles('# One two\n\n**three** four five _six_');
    expect([...marked].sort()).toEqual([...plain].sort());
    const linked = shingles(
      'one two [three](https://a.example/x) four five six',
    );
    expect(linked.size).toBeGreaterThan(plain.size);
  });
});

describe('findNearDuplicates', () => {
  it('pairs two documents with the same text under different titles', () => {
    const body = prose(1, 400);
    const found = findNearDuplicates(
      new Map([
        ['doc-a', `# Checklist\n\n${body}`],
        ['doc-b', `# Setup checklist\n\n${body}`],
        ['doc-c', prose(2, 400)],
      ]),
    );
    expect(found.get('doc-a')).toEqual([
      { id: 'doc-b', similarPercent: 99, relation: 'alike' },
    ]);
    expect(found.get('doc-b')?.map((entry) => entry.id)).toEqual(['doc-a']);
    expect(found.has('doc-c')).toBe(false);
  });

  it('finds a document pasted whole into a longer one', () => {
    const policy = prose(3, 200);
    const found = findNearDuplicates(
      new Map([
        ['policy', policy],
        ['handbook', `${prose(4, 600)}\n\n${policy}\n\n${prose(5, 200)}`],
      ]),
    );
    expect(found.get('policy')).toEqual([
      { id: 'handbook', similarPercent: 19, relation: 'inside' },
    ]);
    expect(found.get('handbook')).toEqual([
      { id: 'policy', similarPercent: 19, relation: 'holds' },
    ]);
  });

  it('leaves documents that share only a template', () => {
    const template = `## Owner\n\n${prose(6, 60)}\n\n## Fields\n\n`;
    const found = findNearDuplicates(
      new Map([
        ['form-a', `${template}${prose(7, 300)}`],
        ['form-b', `${template}${prose(8, 300)}`],
        ['form-c', `${template}${prose(9, 300)}`],
      ]),
    );
    expect(found.size).toBe(0);
  });

  it('finds every copy when many documents hold the same text', () => {
    const body = prose(14, 300);
    const copies = new Map(
      Array.from({ length: 40 }, (_, index) => [
        `copy-${String(index).padStart(2, '0')}`,
        `# Copy ${index}\n\n${body}`,
      ]),
    );
    const found = findNearDuplicates(copies);
    expect(found.size).toBe(40);
    expect(found.get('copy-00')).toHaveLength(39);
  });

  it('leaves documents too short to judge', () => {
    const short = prose(10, 30);
    expect(
      findNearDuplicates(
        new Map([
          ['a', short],
          ['b', short],
        ]),
      ).size,
    ).toBe(0);
  });

  it('gives the same answer whatever order the documents arrive in', () => {
    const body = prose(11, 300);
    const entries: [string, string][] = [
      ['x', body],
      ['y', `${body} ${prose(12, 10)}`],
      ['z', prose(13, 300)],
    ];
    const forward = findNearDuplicates(new Map(entries));
    const backward = findNearDuplicates(new Map([...entries].reverse()));
    expect([...backward].sort()).toEqual([...forward].sort());
  });
});

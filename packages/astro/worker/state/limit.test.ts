import { describe, expect, it } from 'vitest';

import { RECORDS_PER_MINUTE, RecordLimit } from './limit.js';

describe('RecordLimit', () => {
  it('lets a key write its limit a minute, and counts what it drops', () => {
    const limit = new RecordLimit(2);
    expect(limit.take('a', 0)).toEqual({ record: true, dropped: 0 });
    expect(limit.take('a', 1)).toEqual({ record: true, dropped: 0 });
    expect(limit.take('a', 2)).toEqual({ record: false, dropped: 1 });
    expect(limit.take('a', 3)).toEqual({ record: false, dropped: 2 });
    // Another key has a minute of its own.
    expect(limit.take('b', 3)).toEqual({ record: true, dropped: 0 });
    // A minute after its window began, the key starts again.
    expect(limit.take('a', 60_000)).toEqual({ record: true, dropped: 0 });
  });

  it('is 60 a minute unless told otherwise', () => {
    const limit = new RecordLimit();
    const taken = Array.from({ length: RECORDS_PER_MINUTE + 1 }, () =>
      limit.take('a', 0),
    );
    expect(RECORDS_PER_MINUTE).toBe(60);
    expect(taken.filter((entry) => entry.record)).toHaveLength(60);
  });

  it('keeps memory bounded, letting the oldest windows go first', () => {
    const limit = new RecordLimit(1);
    for (let key = 0; key < 10_000; key += 1) {
      limit.take(String(key), 0);
    }
    // Every window is still open: the oldest key is let go for a new one.
    expect(limit.take('new', 1)).toEqual({ record: true, dropped: 0 });
    expect(limit.take('0', 1)).toEqual({ record: true, dropped: 0 });
    expect(limit.take('9999', 1)).toEqual({ record: false, dropped: 1 });
  });
});

import { describe, expect, it } from 'vitest';

import { oneLine } from './text.js';

describe('one line', () => {
  it('collapses whitespace and trims', () => {
    expect(oneLine('  How the\n\t thing  works. ')).toBe(
      'How the thing works.',
    );
  });

  it('turns nothing into undefined', () => {
    expect(oneLine('  \n ')).toBeUndefined();
    expect(oneLine('')).toBeUndefined();
    expect(oneLine(undefined)).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';

import { plural } from './plural.js';

describe('plural', () => {
  it('writes the count with the noun it counts', () => {
    expect(plural(1, 'image')).toBe('1 image');
    expect(plural(0, 'image')).toBe('0 images');
    expect(plural(3, 'image')).toBe('3 images');
  });

  it('takes the plural a noun needs when it is not the singular with s', () => {
    expect(plural(1, 'address', 'addresses')).toBe('1 address');
    expect(plural(2, 'address', 'addresses')).toBe('2 addresses');
  });
});

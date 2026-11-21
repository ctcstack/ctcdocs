import { describe, expect, it } from 'vitest';

import { initialsOf } from './initials.js';

describe('initialsOf', () => {
  it.each([
    ['jane.doe@example.com', 'JD'],
    ['jane_doe-smith@example.com', 'JD'],
    ['admin@example.com', 'AD'],
    ['j@example.com', 'J'],
    ['jane.doe2@example.com', 'JD'],
    ['élise.ørsted@example.com', 'ÉØ'],
    ['1234@example.com', ''],
    ['', ''],
  ])('reads %s as %s', (email, initials) => {
    expect(initialsOf(email)).toBe(initials);
  });
});

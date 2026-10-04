import { describe, expect, it } from 'vitest';

import { timeAgo } from './time-ago';

const NOW = Date.parse('2026-10-04T12:00:00Z');
const before = (minutes: number) =>
  new Date(NOW - minutes * 60_000).toISOString();

describe('timeAgo', () => {
  it.each([
    [4, '4 minutes ago'],
    [0, 'this minute'],
    [3 * 60, '3 hours ago'],
    [47 * 60, '47 hours ago'],
    [3 * 24 * 60, '3 days ago'],
  ])('%i minutes → %s', (minutes, words) => {
    expect(timeAgo(before(minutes), NOW)).toBe(words);
  });

  it('says nothing of a time ahead or unreadable', () => {
    expect(timeAgo(before(-5), NOW)).toBe('');
    expect(timeAgo('soon', NOW)).toBe('');
  });
});

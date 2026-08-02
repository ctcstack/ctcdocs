import { describe, expect, it } from 'vitest';

import {
  categorizeGoogleApiStatus,
  isRetryableGoogleApiStatus,
} from './google-api-error.js';

describe('Google API error classification', () => {
  it.each([
    [401, 'authentication'],
    [403, 'permission'],
    [429, 'rate_limit'],
    [500, 'server'],
    [400, 'invalid_response'],
  ] as const)('categorizes status %i as %s', (status, category) => {
    expect(categorizeGoogleApiStatus(status)).toBe(category);
  });

  it('retries only rate limits and transient server statuses', () => {
    expect([429, 500, 502, 503, 504].every(isRetryableGoogleApiStatus)).toBe(
      true,
    );
    expect([400, 401, 403, 404].some(isRetryableGoogleApiStatus)).toBe(false);
  });
});

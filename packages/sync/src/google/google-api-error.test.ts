import { describe, expect, it } from 'vitest';

import {
  categorizeGoogleApiFailure,
  categorizeGoogleApiStatus,
  describeGoogleApiError,
  GoogleApiError,
  isRetryableGoogleApiFailure,
  isRetryableGoogleApiStatus,
  parseGoogleApiErrorReasons,
  readGoogleApiErrorReasons,
} from './google-api-error.js';

function driveErrorBody(...reasons: unknown[]): string {
  return JSON.stringify({
    error: {
      code: 403,
      message: 'Private Title at https://example.invalid/private',
      errors: reasons.map((reason) => ({
        domain: 'global',
        reason,
        message: 'Private Title at https://example.invalid/private',
      })),
    },
  });
}

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

  it.each([
    ['rateLimitExceeded', 'rate_limit', true],
    ['userRateLimitExceeded', 'rate_limit', true],
    ['dailyLimitExceeded', 'rate_limit', false],
    ['exportSizeLimitExceeded', 'export_size_limit', false],
    ['cannotDownloadFile', 'download_restricted', false],
    ['cannotExportFile', 'download_restricted', false],
    ['insufficientFilePermissions', 'permission', false],
    ['SERVICE_DISABLED', 'permission', false],
  ] as const)(
    'categorizes a 403 with reason %s as %s',
    (reason, category, retryable) => {
      expect(categorizeGoogleApiFailure(403, [reason])).toBe(category);
      expect(isRetryableGoogleApiFailure(403, [reason])).toBe(retryable);
    },
  );

  it('lets a 403 rate limit decide the category among mixed reasons', () => {
    expect(
      categorizeGoogleApiFailure(403, [
        'cannotExportFile',
        'userRateLimitExceeded',
      ]),
    ).toBe('rate_limit');
    expect(
      categorizeGoogleApiFailure(403, [
        'cannotExportFile',
        'exportSizeLimitExceeded',
      ]),
    ).toBe('export_size_limit');
  });

  it('reads reasons only for a 403 and keeps other statuses as they were', () => {
    expect(categorizeGoogleApiFailure(404, ['rateLimitExceeded'])).toBe(
      'invalid_response',
    );
    expect(isRetryableGoogleApiFailure(404, ['rateLimitExceeded'])).toBe(false);
    expect(categorizeGoogleApiFailure(429, [])).toBe('rate_limit');
    expect(isRetryableGoogleApiFailure(503, [])).toBe(true);
  });
});

describe('Google API error reasons', () => {
  it('keeps the reason codes of the Drive error shape and nothing else', () => {
    expect(
      parseGoogleApiErrorReasons(driveErrorBody('exportSizeLimitExceeded')),
    ).toEqual(['exportSizeLimitExceeded']);
  });

  it('keeps the reason of an ErrorInfo detail and ignores other details', () => {
    expect(
      parseGoogleApiErrorReasons(
        JSON.stringify({
          error: {
            code: 403,
            message: 'Private project text',
            status: 'PERMISSION_DENIED',
            details: [
              {
                '@type': 'type.googleapis.com/google.rpc.Help',
                reason: 'NOT_AN_ERROR_INFO',
                links: [{ url: 'https://example.invalid/private' }],
              },
              {
                '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
                reason: 'SERVICE_DISABLED',
                domain: 'googleapis.com',
                metadata: { consumer: 'projects/private' },
              },
            ],
          },
        }),
      ),
    ).toEqual(['SERVICE_DISABLED']);
  });

  it('drops a reason that is not a plain code', () => {
    expect(
      parseGoogleApiErrorReasons(
        driveErrorBody(
          'https://example.invalid/private',
          'ya29.secret-token',
          'two words',
          'person@example.invalid',
          '1leadingDigit',
          'a'.repeat(65),
          '',
          42,
          null,
          { nested: 'rateLimitExceeded' },
          'insufficientFilePermissions',
        ),
      ),
    ).toEqual(['insufficientFilePermissions']);
  });

  it('deduplicates in order and caps the number of reasons', () => {
    expect(
      parseGoogleApiErrorReasons(
        driveErrorBody(
          'userRateLimitExceeded',
          'rateLimitExceeded',
          'userRateLimitExceeded',
        ),
      ),
    ).toEqual(['userRateLimitExceeded', 'rateLimitExceeded']);

    const many = Array.from(
      { length: 20 },
      (_, index) => `reason${String.fromCharCode(65 + index)}`,
    );
    expect(parseGoogleApiErrorReasons(driveErrorBody(...many))).toEqual(
      many.slice(0, 8),
    );
  });

  it.each([
    ['an HTML error page', '<html><body>403 Forbidden</body></html>'],
    ['an empty body', ''],
    ['truncated JSON', driveErrorBody('rateLimitExceeded').slice(0, 40)],
    ['a JSON array', '["rateLimitExceeded"]'],
    ['a string error', '{"error":"rateLimitExceeded"}'],
    ['a non-array errors field', '{"error":{"errors":"rateLimitExceeded"}}'],
  ])('yields no reasons for %s', (_, body) => {
    expect(parseGoogleApiErrorReasons(body)).toEqual([]);
  });

  it('reads the reasons from a response body', async () => {
    await expect(
      readGoogleApiErrorReasons(
        new Response(driveErrorBody('cannotExportFile'), { status: 403 }),
      ),
    ).resolves.toEqual(['cannotExportFile']);
    await expect(
      readGoogleApiErrorReasons(new Response(null, { status: 403 })),
    ).resolves.toEqual([]);
  });

  it('stops reading an oversized body and releases it', async () => {
    let pulls = 0;
    let cancelled = false;
    const chunk = new TextEncoder().encode(' '.repeat(16 * 1024));
    const endless = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"error":{"errors":['));
      },
      pull(controller) {
        pulls += 1;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });

    await expect(
      readGoogleApiErrorReasons(new Response(endless, { status: 403 })),
    ).resolves.toEqual([]);
    expect(pulls).toBeLessThanOrEqual(5);
    expect(cancelled).toBe(true);
  });

  it('yields no reasons when the body fails mid-read', async () => {
    const failing = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('connection reset'));
      },
    });

    await expect(
      readGoogleApiErrorReasons(new Response(failing, { status: 403 })),
    ).resolves.toEqual([]);
  });
});

describe('Google API error description', () => {
  it('names the reason and the file when both are known', () => {
    expect(
      describeGoogleApiError(
        new GoogleApiError(
          'Google Drive API request failed with status 403.',
          'export_size_limit',
          403,
          'safe-request-id',
          { reasons: ['exportSizeLimitExceeded'], fileId: 'doc-id_1' },
        ),
      ),
    ).toBe(
      'status=403 reason=exportSizeLimitExceeded fileId=doc-id_1 requestId=safe-request-id',
    );
  });

  it('keeps the previous fields when there is no reason or file', () => {
    expect(
      describeGoogleApiError(
        new GoogleApiError(
          'Google Drive API network request failed.',
          'network',
          undefined,
          'unavailable',
        ),
      ),
    ).toBe('status=unavailable requestId=unavailable');
  });

  it('refuses a reason or file identifier that is not safe to print', () => {
    const error = new GoogleApiError(
      'Google Drive API request failed with status 403.',
      'permission',
      403,
      'unavailable',
      {
        reasons: ['insufficientFilePermissions', 'Private Title'],
        fileId: 'https://example.invalid/private',
      },
    );

    expect(error.reasons).toEqual(['insufficientFilePermissions']);
    expect(error.fileId).toBeUndefined();
    expect(describeGoogleApiError(error)).toBe(
      'status=403 reason=insufficientFilePermissions requestId=unavailable',
    );
  });

  it('keeps the cause it is given', () => {
    const cause = new Error('underlying');
    expect(
      new GoogleApiError('failed', 'network', undefined, 'unavailable', {
        cause,
        fileId: 'doc-id',
      }).cause,
    ).toBe(cause);
  });
});

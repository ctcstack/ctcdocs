import { describe, expect, it } from 'vitest';

import { StaticGoogleAccessTokenProvider } from './auth.js';
import { GoogleDocsClient } from './docs-client.js';
import { describeGoogleApiError, GoogleApiError } from './google-api-error.js';

interface CapturedRequest {
  headers: Headers;
  url: URL;
}

function createClient(
  response: Response,
  capturedRequests: CapturedRequest[] = [],
): GoogleDocsClient {
  return new GoogleDocsClient({
    accessTokenProvider: new StaticGoogleAccessTokenProvider('secret-token'),
    maxRetries: 0,
    timeoutMilliseconds: 1_000,
    fetchImplementation: async (input, init) => {
      capturedRequests.push({
        headers: new Headers(init?.headers),
        url: new URL(input instanceof URL ? input : input.toString()),
      });
      return response;
    },
    baseUrl: 'https://example.invalid/docs/v1',
  });
}

function errorInfoBody(status: number, reason: string): unknown {
  return {
    error: {
      code: status,
      message: 'Private Title in projects/private',
      status: status === 429 ? 'RESOURCE_EXHAUSTED' : 'PERMISSION_DENIED',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
          reason,
          domain: 'googleapis.com',
          metadata: { consumer: 'projects/private' },
        },
        {
          '@type': 'type.googleapis.com/google.rpc.Help',
          links: [{ url: 'https://example.invalid/private' }],
        },
      ],
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'x-request-id': 'safe-request-id',
    },
  });
}

describe('Google Docs structural client', () => {
  it('inspects every top-level tab without requesting document bodies', async () => {
    const capturedRequests: CapturedRequest[] = [];
    const result = await createClient(
      jsonResponse({
        tabs: [
          {
            tabProperties: { tabId: 'first' },
            documentTab: {
              inlineObjects: {
                drawing: {
                  objectId: 'drawing',
                  inlineObjectProperties: {
                    embeddedObject: { embeddedDrawingProperties: {} },
                  },
                },
              },
            },
          },
          {
            tabProperties: { tabId: 'second' },
            documentTab: {
              positionedObjects: {
                image: {
                  objectId: 'image',
                  positionedObjectProperties: {
                    embeddedObject: { imageProperties: {} },
                  },
                },
              },
            },
          },
        ],
      }),
      capturedRequests,
    ).inspectDocument('doc-id');

    expect(result).toEqual({
      hasEmbeddedDrawings: true,
      hasImages: true,
      inlineObjectCount: 1,
      positionedObjectCount: 1,
      tabCount: 2,
    });
    expect(
      capturedRequests[0]?.url.searchParams.get('includeTabsContent'),
    ).toBe('true');
    expect(capturedRequests[0]?.url.searchParams.get('fields')).not.toContain(
      'body',
    );
    expect(capturedRequests[0]?.headers.get('authorization')).toBe(
      'Bearer secret-token',
    );
  });

  it('fails closed for nested tabs and invalid structural responses', async () => {
    await expect(
      createClient(
        jsonResponse({
          tabs: [
            {
              tabProperties: { tabId: 'parent' },
              childTabs: [{ tabProperties: { tabId: 'child' } }],
            },
          ],
        }),
      ).inspectDocument('nested'),
    ).rejects.toMatchObject({
      message: expect.stringContaining('Nested Google Docs tabs'),
      category: 'invalid_response',
      fileId: 'nested',
    });

    await expect(
      createClient(jsonResponse({ tabs: [] })).inspectDocument('empty'),
    ).rejects.toMatchObject({
      category: 'invalid_response',
      requestId: 'safe-request-id',
    });
  });

  it('categorizes permission failures without exposing the response body', async () => {
    await expect(
      createClient(
        jsonResponse({ private: 'not logged' }, 403),
      ).inspectDocument('forbidden'),
    ).rejects.toMatchObject({
      category: 'permission',
      status: 403,
      reasons: [],
      fileId: 'forbidden',
      requestId: 'safe-request-id',
    });
  });

  it.each([
    [403, 'SERVICE_DISABLED', 'permission'],
    [429, 'RATE_LIMIT_EXCEEDED', 'rate_limit'],
  ] as const)(
    'keeps only the ErrorInfo reason of a %i and names the inspected file',
    async (status, reason, category) => {
      let error: unknown;
      try {
        await createClient(
          jsonResponse(errorInfoBody(status, reason), status),
        ).inspectDocument('doc-id');
        expect.unreachable('Expected request to fail');
      } catch (caught: unknown) {
        error = caught;
      }

      expect(error).toBeInstanceOf(GoogleApiError);
      expect(error).toMatchObject({
        category,
        status,
        reasons: [reason],
        fileId: 'doc-id',
      });
      const line = describeGoogleApiError(error as GoogleApiError);
      expect(line).toBe(
        `status=${status} reason=${reason} fileId=doc-id requestId=safe-request-id`,
      );
      for (const text of [line, (error as Error).message]) {
        expect(text).not.toContain('private');
        expect(text).not.toContain('Private');
      }
    },
  );

  it('retries a 403 rate limit before inspecting', async () => {
    const delays: number[] = [];
    const responses = [
      jsonResponse(
        {
          error: {
            code: 403,
            errors: [
              { domain: 'usageLimits', reason: 'userRateLimitExceeded' },
            ],
          },
        },
        403,
      ),
      jsonResponse({ tabs: [{ tabProperties: { tabId: 'only' } }] }),
    ];
    const client = new GoogleDocsClient({
      accessTokenProvider: new StaticGoogleAccessTokenProvider('secret-token'),
      maxRetries: 1,
      timeoutMilliseconds: 1_000,
      fetchImplementation: async () =>
        responses.shift() ?? Promise.reject(new Error('Unexpected request')),
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      },
      baseUrl: 'https://example.invalid/docs/v1',
    });

    await expect(client.inspectDocument('doc-id')).resolves.toMatchObject({
      tabCount: 1,
    });
    expect(delays).toEqual([250]);
  });
});

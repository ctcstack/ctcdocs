import { describe, expect, it } from 'vitest';

import { StaticGoogleAccessTokenProvider } from './auth.js';
import { GoogleDocsClient } from './docs-client.js';

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
    ).rejects.toThrow('Nested Google Docs tabs');

    await expect(
      createClient(jsonResponse({ tabs: [] })).inspectDocument('empty'),
    ).rejects.toMatchObject({
      category: 'invalid_response',
      requestId: 'safe-request-id',
    });
  });

  it('categorizes permission failures without reading the response body', async () => {
    await expect(
      createClient(
        jsonResponse({ private: 'not logged' }, 403),
      ).inspectDocument('forbidden'),
    ).rejects.toMatchObject({
      category: 'permission',
      status: 403,
      requestId: 'safe-request-id',
    });
  });
});

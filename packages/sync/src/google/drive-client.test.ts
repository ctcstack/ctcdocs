import { describe, expect, it } from 'vitest';

import { StaticGoogleAccessTokenProvider } from './auth.js';
import { GoogleDriveClient, MAX_GOOGLE_EXPORT_BYTES } from './drive-client.js';
import { GoogleApiError } from './google-api-error.js';

interface CapturedRequest {
  url: URL;
  headers: Headers;
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers?: ConstructorParameters<typeof Headers>[0],
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      ...Object.fromEntries(new Headers(headers).entries()),
    },
  });
}

function createQueuedFetch(
  queue: Array<Response | Error>,
  capturedRequests: CapturedRequest[] = [],
): typeof fetch {
  return async (input, init) => {
    capturedRequests.push({
      url: new URL(
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input
            : input.url,
      ),
      headers: new Headers(init?.headers),
    });
    const next = queue.shift();
    if (!next) {
      throw new Error('Unexpected request');
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  };
}

function driveItem(id: string): Record<string, unknown> {
  return {
    id,
    name: id,
    mimeType: 'application/vnd.google-apps.document',
    parents: ['root'],
    modifiedTime: '2026-01-01T00:00:00.000Z',
    createdTime: '2026-01-01T00:00:00.000Z',
    trashed: false,
  };
}

function createClient(
  fetchImplementation: typeof fetch,
  options: {
    maxRetries?: number;
    sleep?: (milliseconds: number) => Promise<void>;
  } = {},
): GoogleDriveClient {
  return new GoogleDriveClient({
    driveId: 'drive-id',
    accessTokenProvider: new StaticGoogleAccessTokenProvider('secret-token'),
    maxRetries: options.maxRetries ?? 2,
    timeoutMilliseconds: 1_000,
    fetchImplementation,
    ...(options.sleep ? { sleep: options.sleep } : {}),
    baseUrl: 'https://example.invalid/drive/v3',
  });
}

describe('Google Drive read-only client', () => {
  it('validates scope and exhausts paginated Shared Drive inventory', async () => {
    const capturedRequests: CapturedRequest[] = [];
    const client = createClient(
      createQueuedFetch(
        [
          jsonResponse({ id: 'drive-id' }),
          jsonResponse({
            id: 'root',
            driveId: 'drive-id',
            mimeType: 'application/vnd.google-apps.folder',
            trashed: false,
          }),
          jsonResponse({
            files: [driveItem('one')],
            nextPageToken: 'next-page',
            incompleteSearch: false,
          }),
          jsonResponse({
            files: [driveItem('two')],
            incompleteSearch: false,
          }),
        ],
        capturedRequests,
      ),
    );

    await client.validateReadScope('root');
    await expect(client.listInventory()).resolves.toHaveLength(2);

    const inventoryRequests = capturedRequests.slice(2);
    expect(inventoryRequests).toHaveLength(2);
    expect(inventoryRequests[0]?.url.searchParams.get('corpora')).toBe('drive');
    expect(inventoryRequests[0]?.url.searchParams.get('driveId')).toBe(
      'drive-id',
    );
    expect(
      inventoryRequests[0]?.url.searchParams.get('includeItemsFromAllDrives'),
    ).toBe('true');
    expect(inventoryRequests[1]?.url.searchParams.get('pageToken')).toBe(
      'next-page',
    );
    expect(inventoryRequests[0]?.headers.get('authorization')).toBe(
      'Bearer secret-token',
    );
  });

  it('honors Retry-After for rate limiting without exposing response bodies', async () => {
    const delays: number[] = [];
    const client = createClient(
      createQueuedFetch([
        jsonResponse({ private: 'must not appear in errors' }, 429, {
          'retry-after': '2',
          'x-request-id': 'safe-request-id',
        }),
        jsonResponse({ files: [] }),
      ]),
      {
        sleep: async (milliseconds) => {
          delays.push(milliseconds);
        },
      },
    );

    await expect(client.listInventory()).resolves.toEqual([]);
    expect(delays).toEqual([2_000]);
  });

  it.each([
    [401, 'authentication'],
    [403, 'permission'],
    [429, 'rate_limit'],
  ] as const)(
    'returns a distinct category for status %i',
    async (status, category) => {
      const client = createClient(
        createQueuedFetch([
          jsonResponse({ sensitive: 'not included' }, status, {
            'x-request-id': 'request-id',
          }),
        ]),
        { maxRetries: 0 },
      );

      try {
        await client.listInventory();
        expect.unreachable('Expected request to fail');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(GoogleApiError);
        expect(error).toMatchObject({
          category,
          status,
          requestId: 'request-id',
        });
        expect((error as Error).message).not.toContain('sensitive');
      }
    },
  );

  it('retries network failures with deterministic exponential backoff', async () => {
    const delays: number[] = [];
    const client = createClient(
      createQueuedFetch([
        new TypeError('network unavailable'),
        jsonResponse({ files: [] }),
      ]),
      {
        sleep: async (milliseconds) => {
          delays.push(milliseconds);
        },
      },
    );

    await expect(client.listInventory()).resolves.toEqual([]);
    expect(delays).toEqual([250]);
  });

  it('rejects incomplete searches, repeated page tokens, and invalid JSON', async () => {
    await expect(
      createClient(
        createQueuedFetch([
          jsonResponse({ files: [], incompleteSearch: true }),
        ]),
      ).listInventory(),
    ).rejects.toThrow('incomplete inventory search');

    await expect(
      createClient(
        createQueuedFetch([
          jsonResponse({ files: [], nextPageToken: 'repeated' }),
          jsonResponse({ files: [], nextPageToken: 'repeated' }),
        ]),
      ).listInventory(),
    ).rejects.toThrow('repeated inventory page token');

    await expect(
      createClient(
        createQueuedFetch([
          new Response('not-json', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ]),
      ).listInventory(),
    ).rejects.toMatchObject({ category: 'invalid_response' });
  });

  it('rejects a root folder outside the configured Shared Drive', async () => {
    const client = createClient(
      createQueuedFetch([
        jsonResponse({ id: 'drive-id' }),
        jsonResponse({
          id: 'root',
          driveId: 'different-drive',
          mimeType: 'application/vnd.google-apps.folder',
          trashed: false,
        }),
      ]),
    );

    await expect(client.validateReadScope('root')).rejects.toThrow(
      'configured root',
    );
  });

  it('exports Markdown bytes using the official Drive export endpoint', async () => {
    const capturedRequests: CapturedRequest[] = [];
    const client = createClient(
      createQueuedFetch(
        [
          new Response('# Safe\n', {
            headers: {
              'content-type': 'text/markdown',
              'content-length': '7',
            },
          }),
        ],
        capturedRequests,
      ),
    );

    await expect(client.exportMarkdown('doc-id')).resolves.toEqual(
      new TextEncoder().encode('# Safe\n'),
    );
    expect(capturedRequests[0]?.url.pathname).toBe(
      '/drive/v3/files/doc-id/export',
    );
    expect(capturedRequests[0]?.url.searchParams.get('mimeType')).toBe(
      'text/markdown',
    );
    expect(capturedRequests[0]?.headers.get('accept')).toBe('text/markdown');
  });

  it('exports an HTML ZIP using the official Drive export endpoint', async () => {
    const capturedRequests: CapturedRequest[] = [];
    const archive = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]);
    const client = createClient(
      createQueuedFetch(
        [
          new Response(archive, {
            headers: { 'content-type': 'application/zip' },
          }),
        ],
        capturedRequests,
      ),
    );

    await expect(client.exportHtmlZip('doc-id')).resolves.toEqual(archive);
    expect(capturedRequests[0]?.url.searchParams.get('mimeType')).toBe(
      'application/zip',
    );
    expect(capturedRequests[0]?.headers.get('accept')).toBe('application/zip');
  });

  it('rejects declared and streamed exports above the 10 MB limit', async () => {
    await expect(
      createClient(
        createQueuedFetch([
          new Response('small', {
            headers: {
              'content-length': String(MAX_GOOGLE_EXPORT_BYTES + 1),
            },
          }),
        ]),
      ).exportMarkdown('declared-too-large'),
    ).rejects.toThrow('10 MB');

    const oversizedChunk = new Uint8Array(MAX_GOOGLE_EXPORT_BYTES + 1);
    await expect(
      createClient(
        createQueuedFetch([
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(oversizedChunk);
                controller.close();
              },
            }),
          ),
        ]),
      ).exportMarkdown('streamed-too-large'),
    ).rejects.toThrow('10 MB');
  });
});

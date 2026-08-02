import { describe, expect, it } from 'vitest';

import type { SyncConfiguration } from '../config.js';
import { StaticGoogleAccessTokenProvider } from '../google/auth.js';
import { runInventory } from './run-inventory.js';
import { testSyncContext } from '../test-support/project-fixture.js';

const context = testSyncContext(process.cwd());

const configuration: SyncConfiguration = {
  GOOGLE_DRIVE_ID: 'drive-id',
  GOOGLE_ROOT_FOLDER_ID: 'published',
  GOOGLE_IGNORED_FOLDER_IDS: [],
  SYNC_CONCURRENCY: 4,
  SYNC_MAX_RETRIES: 0,
  SYNC_FAIL_ON_WARNING: false,
  SYNC_EXPORT_TIMEOUT_MS: 1_000,
  SYNC_SITE_BASE_URL: 'https://wiki.example.com',
  SYNC_DEFAULT_LOCALE: 'en',
  SYNC_DRY_RUN: true,
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('inventory orchestration', () => {
  it('validates scope, lists metadata, and creates a report without writes', async () => {
    const responses = [
      jsonResponse({ id: 'drive-id' }),
      jsonResponse({
        id: 'published',
        driveId: 'drive-id',
        mimeType: 'application/vnd.google-apps.folder',
        trashed: false,
      }),
      jsonResponse({
        files: [
          {
            id: 'published',
            name: 'Published',
            mimeType: 'application/vnd.google-apps.folder',
            parents: [],
            modifiedTime: '2026-01-01T00:00:00.000Z',
            createdTime: '2026-01-01T00:00:00.000Z',
            trashed: false,
          },
          {
            id: 'document',
            name: 'Document',
            mimeType: 'application/vnd.google-apps.document',
            parents: ['published'],
            modifiedTime: '2026-01-02T00:00:00.000Z',
            createdTime: '2026-01-02T00:00:00.000Z',
            trashed: false,
          },
        ],
      }),
    ];
    const fetchImplementation: typeof fetch = async () => {
      const response = responses.shift();
      if (!response) {
        throw new Error('Unexpected request');
      }
      return response;
    };

    const result = await runInventory(
      context,
      configuration,
      new StaticGoogleAccessTokenProvider('short-lived-token'),
      {
        fetchImplementation,
        baseUrl: 'https://example.invalid/drive/v3',
      },
    );

    expect(result.report.summary).toMatchObject({
      allItems: 2,
      folders: 1,
      documents: 1,
      unsupported: 0,
    });
    expect(responses).toEqual([]);
  });

  it('promotes inventory warnings to failures when configured', async () => {
    const responses = [
      jsonResponse({ id: 'drive-id' }),
      jsonResponse({
        id: 'published',
        driveId: 'drive-id',
        mimeType: 'application/vnd.google-apps.folder',
        trashed: false,
      }),
      jsonResponse({
        files: [
          {
            id: 'published',
            name: 'Published',
            mimeType: 'application/vnd.google-apps.folder',
            parents: [],
            modifiedTime: '2026-01-01T00:00:00.000Z',
            createdTime: '2026-01-01T00:00:00.000Z',
            trashed: false,
          },
        ],
      }),
    ];
    const fetchImplementation: typeof fetch = async () => {
      const response = responses.shift();
      if (!response) {
        throw new Error('Unexpected request');
      }
      return response;
    };

    await expect(
      runInventory(
        context,
        {
          ...configuration,
          GOOGLE_IGNORED_FOLDER_IDS: ['missing-folder'],
          SYNC_FAIL_ON_WARNING: true,
        },
        new StaticGoogleAccessTokenProvider('short-lived-token'),
        {
          fetchImplementation,
          baseUrl: 'https://example.invalid/drive/v3',
        },
      ),
    ).rejects.toMatchObject({
      issues: [{ code: 'ignored_not_found', itemId: 'missing-folder' }],
    });
  });
});

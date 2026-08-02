import { describe, expect, it } from 'vitest';

import {
  GOOGLE_DRIVE_DOCUMENT_MIME_TYPE,
  GOOGLE_DRIVE_FOLDER_MIME_TYPE,
  type DriveItem,
} from '../google/drive-types.js';
import { buildInventorySelection } from '../inventory/inventory-graph.js';
import { createEmptyManifest, type SyncedDocumentRecord } from '../manifest.js';
import { createSidebar, serializeSidebar } from './sidebar.js';
import {
  TEST_SOURCE_HEADER,
  testSiteConfiguration,
} from '../test-support/project-fixture.js';

const LANDING_TITLES = testSiteConfiguration.navigation.landingDocumentTitles;

const timestamp = '2026-01-01T00:00:00.000Z';

function item(
  id: string,
  name: string,
  mimeType: string,
  parent: string,
): DriveItem {
  return {
    id,
    name,
    mimeType,
    parents: [parent],
    modifiedTime: timestamp,
    createdTime: timestamp,
    trashed: false,
  };
}

function record(id: string, slug: string): SyncedDocumentRecord {
  return {
    googleFileId: id,
    googleParentId: 'root',
    googleName: id,
    displayTitle: id,
    googleModifiedTime: timestamp,
    sourceUrl: `https://docs.google.com/document/d/${id}/edit`,
    stableSlug: slug,
    generatedMarkdownPath: `src/content/docs/_generated/${id}.md`,
    generatedAssetsDirectory: `src/assets/generated/${id}`,
    contentHash: `sha256:${'0'.repeat(64)}`,
    outputHash: `sha256:${'1'.repeat(64)}`,
    lastSuccessfulSyncAt: timestamp,
    exportMode: 'markdown',
    warnings: [],
  };
}

describe('generated sidebar', () => {
  it('orders nested folders, omits empty folders, and groups root documents', () => {
    const selection = buildInventorySelection(
      [
        item('root', 'Published', GOOGLE_DRIVE_FOLDER_MIME_TYPE, 'drive'),
        item('team', '02 - Team', GOOGLE_DRIVE_FOLDER_MIME_TYPE, 'root'),
        item('empty', '01 - Empty', GOOGLE_DRIVE_FOLDER_MIME_TYPE, 'root'),
        item('nested', '01 - Nested', GOOGLE_DRIVE_FOLDER_MIME_TYPE, 'team'),
        item(
          'root-doc',
          '02 - Root guide',
          GOOGLE_DRIVE_DOCUMENT_MIME_TYPE,
          'root',
        ),
        item(
          'nested-doc',
          '01 - Nested guide',
          GOOGLE_DRIVE_DOCUMENT_MIME_TYPE,
          'nested',
        ),
      ],
      'root',
      [],
      ['drive'],
    );
    const manifest = createEmptyManifest('drive', 'root', timestamp);
    manifest.documents['root-doc'] = record('root-doc', 'root-guide');
    manifest.documents['nested-doc'] = record(
      'nested-doc',
      'team/nested-guide',
    );

    const sidebar = createSidebar(selection, manifest, LANDING_TITLES);
    expect(sidebar).toEqual([
      {
        label: 'General',
        items: [{ label: 'Root guide', slug: 'root-guide' }],
      },
      {
        label: 'Team',
        items: [
          {
            label: 'Nested',
            items: [
              {
                label: 'Nested guide',
                slug: 'team/nested-guide',
              },
            ],
          },
        ],
      },
    ]);
    expect(serializeSidebar(sidebar, TEST_SOURCE_HEADER)).toContain(
      "satisfies NonNullable<StarlightUserConfig['sidebar']>",
    );
  });

  it('opens a group with the folder landing document', () => {
    const selection = buildInventorySelection(
      [
        item('root', 'Published', GOOGLE_DRIVE_FOLDER_MIME_TYPE, 'drive'),
        item('team', '01 - Team', GOOGLE_DRIVE_FOLDER_MIME_TYPE, 'root'),
        item('guide', '01 - Guide', GOOGLE_DRIVE_DOCUMENT_MIME_TYPE, 'team'),
        item('overview', 'Overview', GOOGLE_DRIVE_DOCUMENT_MIME_TYPE, 'team'),
      ],
      'root',
      [],
      ['drive'],
    );
    const manifest = createEmptyManifest('drive', 'root', timestamp);
    manifest.documents['guide'] = record('guide', 'team/guide');
    manifest.documents['overview'] = record('overview', 'team/overview');

    expect(createSidebar(selection, manifest, ['Overview'])).toEqual([
      {
        label: 'Team',
        items: [
          { label: 'Overview', slug: 'team/overview' },
          { label: 'Guide', slug: 'team/guide' },
        ],
      },
    ]);
  });

  it('returns an empty sidebar for an empty publication root', () => {
    const selection = buildInventorySelection(
      [item('root', 'Published', GOOGLE_DRIVE_FOLDER_MIME_TYPE, 'drive')],
      'root',
      [],
      ['drive'],
    );
    expect(
      createSidebar(
        selection,
        createEmptyManifest('drive', 'root', timestamp),
        LANDING_TITLES,
      ),
    ).toEqual([]);
  });

  it('fails closed when a selected document has no manifest record', () => {
    const selection = buildInventorySelection(
      [
        item('root', 'Published', GOOGLE_DRIVE_FOLDER_MIME_TYPE, 'drive'),
        item('doc', 'Document', GOOGLE_DRIVE_DOCUMENT_MIME_TYPE, 'root'),
      ],
      'root',
      [],
      ['drive'],
    );
    expect(() =>
      createSidebar(
        selection,
        createEmptyManifest('drive', 'root', timestamp),
        LANDING_TITLES,
      ),
    ).toThrow('manifest record');
  });
});

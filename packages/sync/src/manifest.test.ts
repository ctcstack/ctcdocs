import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createEmptyManifest,
  loadManifest,
  ManifestError,
  serializeManifest,
} from './manifest.js';

const temporaryDirectories: string[] = [];
const timestamp = '2026-01-01T00:00:00.000Z';

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('sync manifest', () => {
  it('creates an empty manifest when no file exists', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'kb-manifest-'));
    temporaryDirectories.push(directory);

    await expect(
      loadManifest(
        resolve(directory, 'missing.json'),
        'drive',
        'root',
        timestamp,
      ),
    ).resolves.toEqual(createEmptyManifest('drive', 'root', timestamp));
  });

  it('serializes record keys deterministically', () => {
    const manifest = createEmptyManifest('drive', 'root', timestamp);
    manifest.folders = {
      z: {
        googleFolderId: 'z',
        googleParentId: null,
        googleName: 'Z',
        displayLabel: 'Z',
        sortOrder: null,
      },
      a: {
        googleFolderId: 'a',
        googleParentId: null,
        googleName: 'A',
        displayLabel: 'A',
        sortOrder: null,
      },
    };

    expect(serializeManifest(manifest).indexOf('"a"')).toBeLessThan(
      serializeManifest(manifest).indexOf('"z"'),
    );
  });

  it('migrates a valid schema v1 manifest with an empty redirect map', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'kb-manifest-'));
    temporaryDirectories.push(directory);
    const path = resolve(directory, 'manifest.json');
    const legacy = {
      ...createEmptyManifest('drive', 'root', timestamp),
      schemaVersion: 1,
    } as Record<string, unknown>;
    delete legacy.redirects;
    await writeFile(path, `${JSON.stringify(legacy)}\n`);

    await expect(
      loadManifest(path, 'drive', 'root', timestamp),
    ).resolves.toMatchObject({
      schemaVersion: 3,
      redirects: {},
    });
  });

  it('migrates schema v2 folders without disturbing what they describe', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'kb-manifest-'));
    temporaryDirectories.push(directory);
    const path = resolve(directory, 'manifest.json');
    const legacy = {
      ...createEmptyManifest('drive', 'root', timestamp),
      schemaVersion: 2,
      folders: {
        team: {
          googleFolderId: 'team',
          googleParentId: 'root',
          googleName: '01 - Team',
          displayLabel: 'Team',
          sortOrder: 1,
        },
      },
    };
    await writeFile(path, `${JSON.stringify(legacy)}\n`);

    const migrated = await loadManifest(path, 'drive', 'root', timestamp);

    /*
     * The label and the parent survive: they decide a document's folder path
     * and slug, so losing them here would re-export the whole corpus on the
     * run that migrates. The slug is the one thing a v2 manifest cannot carry,
     * and the sync allocates it.
     */
    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.folders['team']).toEqual({
      googleFolderId: 'team',
      googleParentId: 'root',
      googleName: '01 - Team',
      displayLabel: 'Team',
      sortOrder: 1,
    });
  });

  it('rejects malformed JSON, invalid schema, and a mismatched scope', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'kb-manifest-'));
    temporaryDirectories.push(directory);
    const path = resolve(directory, 'manifest.json');

    await writeFile(path, '{');
    await expect(
      loadManifest(path, 'drive', 'root', timestamp),
    ).rejects.toBeInstanceOf(ManifestError);

    await writeFile(path, '{}');
    await expect(
      loadManifest(path, 'drive', 'root', timestamp),
    ).rejects.toBeInstanceOf(ManifestError);

    await writeFile(
      path,
      serializeManifest(createEmptyManifest('other', 'root', timestamp)),
    );
    await expect(
      loadManifest(path, 'drive', 'root', timestamp),
    ).rejects.toThrow('scope');
  });
});

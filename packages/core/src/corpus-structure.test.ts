import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CorpusStructureError,
  EMPTY_CORPUS,
  parseCorpusStructure,
  readCorpusStructure,
} from './corpus-structure.js';
import { PROJECT_LAYOUT } from './project-layout.js';

describe('corpus structure', () => {
  it('reads folders and documents with their parents', () => {
    const corpus = parseCorpusStructure({
      rootFolderId: 'root',
      folders: {
        root: { googleParentId: null, googleName: 'R', displayLabel: 'R' },
        a: {
          googleParentId: 'root',
          googleName: '01 - A',
          displayLabel: 'A',
          stableSlug: 'a',
          sortOrder: 1,
        },
      },
      documents: { d: { googleParentId: 'a', stableSlug: 'a/d', title: 'x' } },
    });
    expect(corpus.rootFolderId).toBe('root');
    expect(corpus.folders.get('a')).toEqual({
      id: 'a',
      parentId: 'root',
      name: '01 - A',
      label: 'A',
      slug: 'a',
    });
    expect(corpus.folders.get('root')?.slug).toBe(undefined);
    expect(corpus.documents.get('d')).toEqual({
      id: 'd',
      parentId: 'a',
      slug: 'a/d',
    });
  });

  it('reads the short ID, title, modified time and source an agent needs', () => {
    const corpus = parseCorpusStructure({
      folders: {},
      documents: {
        d: {
          googleParentId: null,
          stableSlug: 'd',
          shortId: '1a2b3c',
          displayTitle: 'Handbook',
          googleModifiedTime: '2026-10-01T00:00:00.000Z',
          sourceUrl: 'https://docs.google.com/document/d/handbook/edit',
        },
        e: { googleParentId: null, stableSlug: 'e', shortId: '' },
      },
    });
    expect(corpus.documents.get('d')).toEqual({
      id: 'd',
      parentId: null,
      slug: 'd',
      shortId: '1a2b3c',
      title: 'Handbook',
      modified: '2026-10-01T00:00:00.000Z',
      source: 'https://docs.google.com/document/d/handbook/edit',
    });
    expect(corpus.documents.get('e')).toEqual({
      id: 'e',
      parentId: null,
      slug: 'e',
    });
  });

  it('reads the readers a document was published with, and a waiting move', () => {
    const corpus = parseCorpusStructure({
      folders: {},
      documents: {
        held: {
          googleParentId: null,
          stableSlug: 'held',
          publishedReaders: ['team@example.com'],
          publishedChain: ['team'],
          readersHeld: { chain: ['open'], rules: '0123456789abcdef' },
        },
        settled: {
          googleParentId: null,
          stableSlug: 'settled',
          publishedReaders: '*',
          publishedChain: ['open'],
        },
      },
    });
    expect(corpus.documents.get('held')).toEqual({
      id: 'held',
      parentId: null,
      slug: 'held',
      publishedReaders: ['team@example.com'],
      readersHeld: true,
    });
    expect(corpus.documents.get('settled')).toEqual({
      id: 'settled',
      parentId: null,
      slug: 'settled',
      publishedReaders: '*',
    });
  });

  it('refuses a manifest it cannot read the chain from', () => {
    expect(() => parseCorpusStructure({ folders: [], documents: {} })).toThrow(
      CorpusStructureError,
    );
    expect(() =>
      parseCorpusStructure({
        folders: {
          a: { googleParentId: 3, googleName: 'A', displayLabel: 'A' },
        },
        documents: {},
      }),
    ).toThrow(/folders\.a\.googleParentId/u);
  });

  it('is empty before the first sync', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'ctcdocs-corpus-'));
    expect(readCorpusStructure(root)).toBe(EMPTY_CORPUS);

    const manifest = resolve(root, PROJECT_LAYOUT.manifestFile);
    mkdirSync(dirname(manifest), { recursive: true });
    writeFileSync(manifest, '{');
    expect(() => readCorpusStructure(root)).toThrow(SyntaxError);
  });
});

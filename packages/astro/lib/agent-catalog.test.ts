import type { CorpusDocument, CorpusFolder } from '@ctcstack/ctcdocs-core';
import { describe, expect, it } from 'vitest';

import { buildAgentCatalog } from './agent-catalog.js';

type Field = 'shortId' | 'title' | 'modified' | 'source';

const document = (
  slug: string,
  extra: Partial<CorpusDocument> = {},
  without: readonly Field[] = [],
): CorpusDocument => {
  const value: Record<string, unknown> = {
    id: `drive-${slug}`,
    parentId: null,
    slug,
    shortId: `${slug.length}a${slug.length}b`,
    title: `Title of ${slug}`,
    modified: '2026-10-01T00:00:00.000Z',
    source: `https://docs.google.com/document/d/${slug}/edit`,
    ...extra,
  };
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !without.includes(key as Field)),
  ) as unknown as CorpusDocument;
};

/** A Markdown version as the site serves it, front matter first. */
const projection = (body: string, syncedAt = '2026-10-02T00:00:00.000Z') =>
  `---\ntitle: "x"\nsynced_at: "${syncedAt}"\n---\n\n${body}`;

const PROJECTIONS: Record<string, string> = {
  '/handbook/index.md': projection('# Handbook\n'),
  '/team/plan/index.md': projection('# Plan\n'),
  '/shared/index.md': projection('# Shared\n'),
};

const folder = (
  id: string,
  parentId: string | null,
  label: string,
): [string, CorpusFolder] => [
  id,
  { id, parentId, name: `01 ${label}`, label, slug: undefined },
];

/** The root, a team folder, and a folder of plans inside it. */
const FOLDERS = new Map([
  folder('root', null, 'Root'),
  folder('team', 'root', 'Team'),
  folder('plans', 'team', 'Plans'),
]);

async function catalog(
  documents: CorpusDocument[],
  files: Record<string, string | string[]>,
  projections: Record<string, string> = PROJECTIONS,
) {
  return buildAgentCatalog({
    documents,
    folders: FOLDERS,
    files: new Map(Object.entries(files)),
    readMarkdown: (path) => Promise.resolve(projections[path]),
  });
}

describe('agent catalog', () => {
  it('lists each projected document with one class, by short ID', async () => {
    const result = await catalog(
      [
        document('team/plan', { shortId: 'bbbbbb' }),
        document('handbook', { shortId: 'aaaaaa' }),
      ],
      {
        '/handbook/index.md': 'members',
        '/team/plan/index.md': 'team0001',
      },
    );
    expect(result.documents.map((entry) => entry.id)).toEqual([
      'aaaaaa',
      'bbbbbb',
    ]);
    expect(result.documents[0]).toMatchObject({
      id: 'aaaaaa',
      title: 'Title of handbook',
      markdown: '/handbook/index.md',
      modified: '2026-10-01T00:00:00.000Z',
      source: 'https://docs.google.com/document/d/handbook/edit',
    });
  });

  it('leaves out a document without a short ID, a projection or one class', async () => {
    const result = await catalog(
      [
        document('handbook', {}, ['shortId']),
        document('missing'),
        document('shared'),
      ],
      {
        '/handbook/index.md': 'members',
        '/shared/index.md': ['members', 'team0001'],
      },
    );
    expect(result.documents).toEqual([]);
  });

  it('changes the hash and digest when the class, title or text changes', async () => {
    const files = { '/handbook/index.md': 'members' };
    const base = await catalog([document('handbook')], files);
    const again = await catalog([document('handbook')], files);
    const moved = await catalog([document('handbook')], {
      '/handbook/index.md': 'team0001',
    });
    const renamed = await catalog(
      [document('handbook', { title: 'Renamed' })],
      files,
    );
    expect(again).toEqual(base);
    expect(moved.documents[0]?.hash).not.toBe(base.documents[0]?.hash);
    expect(moved.digest).not.toBe(base.digest);
    expect(renamed.documents[0]?.hash).not.toBe(base.documents[0]?.hash);

    const edited = await catalog([document('handbook')], files, {
      '/handbook/index.md': projection('# Handbook\n\nEdited.\n'),
    });
    expect(edited.documents[0]?.hash).not.toBe(base.documents[0]?.hash);
  });

  it('hashes the text the Worker stores, not the front matter', async () => {
    const files = { '/handbook/index.md': 'members' };
    const base = await catalog([document('handbook')], files);
    const resynced = await catalog([document('handbook')], files, {
      '/handbook/index.md': projection(
        '# Handbook\n',
        '2026-10-03T00:00:00.000Z',
      ),
    });
    expect(resynced).toEqual(base);

    // A file the site would not have written has no text to store.
    const bare = await catalog([document('handbook')], files, {
      '/handbook/index.md': '# Handbook\n',
    });
    expect(bare.documents).toEqual([]);
  });

  it('names the folders a document sits in, without the root', async () => {
    const result = await catalog(
      [
        document('handbook', { shortId: 'aaaaaa', parentId: 'root' }),
        document('team/plan', { shortId: 'bbbbbb', parentId: 'plans' }),
        document('shared', { shortId: 'cccccc', parentId: 'gone' }),
      ],
      {
        '/handbook/index.md': 'members',
        '/team/plan/index.md': 'team0001',
        '/shared/index.md': 'members',
      },
    );
    expect(result.documents.map((entry) => entry.path)).toEqual([
      [],
      ['Team', 'Plans'],
      [],
    ]);
  });

  it('falls back to the slug for a title and to null for a time or a source', async () => {
    const result = await catalog(
      [document('handbook', {}, ['title', 'modified', 'source'])],
      { '/handbook/index.md': 'members' },
    );
    expect(result.documents[0]).toMatchObject({
      title: 'handbook',
      modified: null,
      source: null,
    });
  });
});

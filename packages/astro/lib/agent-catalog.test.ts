import type { CorpusDocument } from '@ctcstack/ctcdocs-core';
import { describe, expect, it } from 'vitest';

import { buildAgentCatalog } from './agent-catalog.js';

type Field = 'shortId' | 'title' | 'modified';

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
    ...extra,
  };
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !without.includes(key as Field)),
  ) as unknown as CorpusDocument;
};

const projections: Record<string, string> = {
  '/handbook/index.md': '# Handbook\n',
  '/team/plan/index.md': '# Plan\n',
  '/shared/index.md': '# Shared\n',
};

async function catalog(
  documents: CorpusDocument[],
  files: Record<string, string | string[]>,
) {
  return buildAgentCatalog({
    documents,
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
  });

  it('falls back to the slug for a title and to null for a time', async () => {
    const result = await catalog(
      [document('handbook', {}, ['title', 'modified'])],
      { '/handbook/index.md': 'members' },
    );
    expect(result.documents[0]).toMatchObject({
      title: 'handbook',
      modified: null,
    });
  });
});

import { describe, expect, it } from 'vitest';

import { archiveLinks } from './archive-links.js';

const origins = ['https://docs.example.com'];
const zip = (id: string) => `https://drive.google.com/file/d/${id}/view`;

describe('archiveLinks', () => {
  const archives = new Set(['zip-one', 'zip-two', 'zip-unlinked']);

  it('finds an archive linked by its Drive address or its download address', () => {
    const { linked } = archiveLinks(
      new Map([
        ['page-a', `[Kit](${zip('zip-one')})`],
        [
          'page-b',
          '[Kit](https://drive.usercontent.google.com/download?id=zip-two&export=download)',
        ],
      ]),
      archives,
      new Set(),
      origins,
    );

    expect([...linked].sort()).toEqual(['zip-one', 'zip-two']);
  });

  it('names a page only when every link it is noted for leads to an archive', () => {
    const { onlyToArchives } = archiveLinks(
      new Map([
        ['only', `[Kit](${zip('zip-one')})`],
        [
          'untyped',
          `[Kit](${zip('zip-one')}) [Deck](https://drive.google.com/open?id=deck)`,
        ],
        ['mixed', `[Kit](${zip('zip-one')}) [Other](${zip('other-file')})`],
        [
          'published',
          `[Kit](${zip('zip-one')}) [Guide](https://docs.google.com/document/d/guide/edit)`,
        ],
        ['none', 'No links at all.'],
      ]),
      archives,
      new Set(['guide']),
      origins,
    );

    expect([...onlyToArchives].sort()).toEqual([
      'only',
      'published',
      'untyped',
    ]);
  });

  it('reads nothing when there is no archive', () => {
    expect(
      archiveLinks(
        new Map([['page', `[Kit](${zip('zip-one')})`]]),
        new Set(),
        new Set(),
        origins,
      ),
    ).toEqual({ linked: new Set(), onlyToArchives: new Set() });
  });
});

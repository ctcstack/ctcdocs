import { describe, expect, it } from 'vitest';

import {
  documentCountLabel,
  sectionListingRows,
  type ListedPage,
} from './section-listing.js';

const pages = new Map<string, ListedPage>([
  [
    'team/runbooks',
    {
      sourceType: 'section-index',
      title: 'Runbooks',
      description: undefined,
      googleModifiedTime: undefined,
    },
  ],
  [
    'team/guide',
    {
      sourceType: 'google-doc',
      title: 'Guide',
      description: '  How the\n thing is done. ',
      googleModifiedTime: '2026-02-05T08:15:00.000Z',
    },
  ],
]);

describe('section listing rows', () => {
  it('draws each entry from the page it points at, in the recorded order', () => {
    expect(
      sectionListingRows(
        [
          { kind: 'folder', slug: 'team/runbooks', documentCount: 3 },
          { kind: 'document', slug: 'team/guide' },
        ],
        pages,
      ),
    ).toEqual([
      {
        kind: 'folder',
        href: '/team/runbooks/',
        label: 'Runbooks',
        documentCount: 3,
      },
      {
        kind: 'document',
        href: '/team/guide/',
        label: 'Guide',
        description: 'How the thing is done.',
        modified: new Date('2026-02-05T08:15:00.000Z'),
      },
    ]);
  });

  it('falls back to the Markdown list when there is nothing to draw', () => {
    expect(sectionListingRows(undefined, pages)).toBeUndefined();
    expect(sectionListingRows([], pages)).toBeUndefined();
  });

  it('falls back when an entry points at a missing page', () => {
    expect(
      sectionListingRows([{ kind: 'document', slug: 'team/gone' }], pages),
    ).toBeUndefined();
  });

  it('falls back when an entry names the wrong kind of page', () => {
    expect(
      sectionListingRows(
        [{ kind: 'folder', slug: 'team/guide', documentCount: 1 }],
        pages,
      ),
    ).toBeUndefined();
    expect(
      sectionListingRows([{ kind: 'document', slug: 'team/runbooks' }], pages),
    ).toBeUndefined();
  });
});

describe('document count label', () => {
  it('says how much a folder holds', () => {
    expect(documentCountLabel(0)).toBe('Empty');
    expect(documentCountLabel(1)).toBe('1 document');
    expect(documentCountLabel(12)).toBe('12 documents');
  });
});

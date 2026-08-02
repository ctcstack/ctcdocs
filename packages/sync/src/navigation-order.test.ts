import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  GOOGLE_DRIVE_DOCUMENT_MIME_TYPE,
  GOOGLE_DRIVE_FOLDER_MIME_TYPE,
  type DriveItem,
} from './google/drive-types.js';
import { buildInventorySelection } from './inventory/inventory-graph.js';
import {
  compareNavigationSiblings,
  findNavigationOrderIssues,
  type NavigationSibling,
} from './navigation-order.js';

const LANDING_TITLES = ['Overview', 'README', 'About'];
const timestamp = '2026-01-01T00:00:00.000Z';

function document(name: string, id = name): NavigationSibling {
  return { id, name, kind: 'document' };
}

function folder(name: string, id = name): NavigationSibling {
  return { id, name, kind: 'folder' };
}

function order(siblings: readonly NavigationSibling[]): string[] {
  return [...siblings]
    .sort((left, right) =>
      compareNavigationSiblings(left, right, LANDING_TITLES),
    )
    .map((sibling) => sibling.name);
}

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

function selectionOf(children: readonly NavigationSibling[]) {
  return buildInventorySelection(
    [
      item('root', 'Published', GOOGLE_DRIVE_FOLDER_MIME_TYPE, 'drive'),
      ...children.map((child) =>
        item(
          child.id,
          child.name,
          child.kind === 'folder'
            ? GOOGLE_DRIVE_FOLDER_MIME_TYPE
            : GOOGLE_DRIVE_DOCUMENT_MIME_TYPE,
          'root',
        ),
      ),
    ],
    'root',
    [],
    ['drive'],
  );
}

describe('navigation order', () => {
  it('opens a folder with its landing document', () => {
    expect(
      order([
        document('Appendix'),
        document('01 - Introduction'),
        document('Overview'),
      ]),
    ).toEqual(['Overview', '01 - Introduction', 'Appendix']);
  });

  it('places numbered siblings before unnumbered ones', () => {
    expect(
      order([
        document('Zulu'),
        folder('02 - Beta'),
        document('01 - Alpha'),
        document('alpha'),
      ]),
    ).toEqual(['01 - Alpha', '02 - Beta', 'alpha', 'Zulu']);
  });

  it('lets an explicit number outrank the landing convention', () => {
    expect(
      order([
        document('05 - Overview'),
        document('01 - Introduction'),
        document('Appendix'),
      ]),
    ).toEqual(['01 - Introduction', '05 - Overview', 'Appendix']);
  });

  it('breaks a tie between landing documents on the configured precedence', () => {
    expect(order([document('About'), document('README'), document('Overview')]))
      // The configured list reads Overview, README, About.
      .toEqual(['Overview', 'README', 'About']);
  });

  it('does not promote a folder that carries a landing title', () => {
    expect(order([folder('Overview'), document('01 - Introduction')])).toEqual([
      '01 - Introduction',
      'Overview',
    ]);
  });

  it('breaks a duplicated number on the label, then on the identifier', () => {
    expect(
      order([
        document('01 - Beta', 'b'),
        document('01 - Alpha', 'z'),
        document('01 - Alpha', 'a'),
      ]),
    ).toEqual(['01 - Alpha', '01 - Alpha', '01 - Beta']);
    expect(
      [document('01 - Alpha', 'z'), document('01 - Alpha', 'a')]
        .sort((left, right) =>
          compareNavigationSiblings(left, right, LANDING_TITLES),
        )
        .map((sibling) => sibling.id),
    ).toEqual(['a', 'z']);
  });

  it('produces one order for a set of siblings however they arrive', () => {
    const names = fc.constantFrom(
      'Overview',
      'README',
      'Appendix',
      'appendix',
      '01 - Alpha',
      '[02] Beta',
      '3. Gamma',
      '2024 Report',
      'Zulu',
    );
    fc.assert(
      fc.property(
        fc.uniqueArray(names, { minLength: 2, maxLength: 9 }),
        fc.nat(),
        (unique, rotation) => {
          const siblings = unique.map((name, index) =>
            document(name, `id-${index}`),
          );
          const offset = rotation % siblings.length;
          const rotated = [
            ...siblings.slice(offset),
            ...siblings.slice(0, offset),
          ];
          expect(order(rotated)).toEqual(order(siblings));
        },
      ),
    );
  });
});

describe('navigation order issues', () => {
  it('reports two siblings claiming the same number', () => {
    expect(
      findNavigationOrderIssues(
        selectionOf([document('01 - Alpha', 'a'), document('01 - Beta', 'b')]),
        LANDING_TITLES,
      ),
    ).toEqual([
      { code: 'duplicate_navigation_order', itemId: 'b', relatedId: 'a' },
    ]);
  });

  it('reports a second landing document in one folder', () => {
    expect(
      findNavigationOrderIssues(
        selectionOf([document('Overview', 'o'), document('README', 'r')]),
        LANDING_TITLES,
      ),
    ).toEqual([
      { code: 'multiple_landing_documents', itemId: 'r', relatedId: 'o' },
    ]);
  });

  it('reports an unaccepted prefix only where the convention is in use', () => {
    expect(
      findNavigationOrderIssues(
        selectionOf([document('01 - Alpha', 'a'), document('02 Beta', 'b')]),
        LANDING_TITLES,
      ),
    ).toEqual([{ code: 'unrecognized_order_prefix', itemId: 'b' }]);
    expect(
      findNavigationOrderIssues(
        selectionOf([document('02 Beta', 'b'), document('Gamma', 'g')]),
        LANDING_TITLES,
      ),
    ).toEqual([]);
  });

  it('stays quiet on a folder mixing numbered and unnumbered siblings', () => {
    expect(
      findNavigationOrderIssues(
        selectionOf([
          document('Overview', 'o'),
          document('01 - Alpha', 'a'),
          document('Appendix', 'z'),
          folder('02 - Beta', 'b'),
        ]),
        LANDING_TITLES,
      ),
    ).toEqual([]);
  });
});

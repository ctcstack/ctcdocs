import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { AccessConfiguration } from './access-configuration.js';
import {
  ADMINS_CLASS,
  classIdentifiers,
  computeAccessModel,
  documentClass,
  folderClass,
  intersectReaders,
  MEMBERS_CLASS,
  widensReaders,
} from './access-classes.js';
import { parseCorpusStructure } from './corpus-structure.js';

/*
 * root ─┬─ open ── open-sub
 *       ├─ team ─┬─ team-sub
 *       │        └─ team-narrow
 *       └─ unruled
 */
const corpus = parseCorpusStructure({
  rootFolderId: 'root',
  folders: {
    root: { googleParentId: null, googleName: 'Root', displayLabel: 'Root' },
    open: {
      googleParentId: 'root',
      googleName: '01 - Open',
      displayLabel: 'Open',
      stableSlug: 'open',
    },
    'open-sub': {
      googleParentId: 'open',
      googleName: 'Sub',
      displayLabel: 'Sub',
      stableSlug: 'open/sub',
    },
    team: {
      googleParentId: 'root',
      googleName: 'Team',
      displayLabel: 'Team',
      stableSlug: 'team',
    },
    'team-sub': {
      googleParentId: 'team',
      googleName: 'Sub',
      displayLabel: 'Sub',
      stableSlug: 'team/sub',
    },
    'team-narrow': {
      googleParentId: 'team',
      googleName: 'Leads',
      displayLabel: 'Leads',
      stableSlug: 'team/leads',
    },
    unruled: {
      googleParentId: 'root',
      googleName: 'Unruled',
      displayLabel: 'Unruled',
      stableSlug: 'unruled',
    },
  },
  documents: {
    'doc-root': { googleParentId: 'root', stableSlug: 'start' },
    'doc-open': { googleParentId: 'open-sub', stableSlug: 'open/sub/a' },
    'doc-team': { googleParentId: 'team-sub', stableSlug: 'team/sub/b' },
    'doc-leads': { googleParentId: 'team-narrow', stableSlug: 'team/leads/c' },
    'doc-unruled': { googleParentId: 'unruled', stableSlug: 'unruled/d' },
    'doc-orphan': { googleParentId: 'gone', stableSlug: 'orphan' },
  },
});

const access: AccessConfiguration = {
  admins: ['admins@example.com'],
  rules: [
    { folder: 'open', label: 'Open', readers: ['*'] },
    {
      folder: 'team',
      label: 'Team',
      readers: ['leads@example.com', 'team@example.com'],
    },
    {
      folder: 'team-narrow',
      label: 'Leads',
      readers: ['leads@example.com', 'outsiders@example.com'],
    },
  ],
};

describe('computeAccessModel', () => {
  it('opens everything without an access section', () => {
    const model = computeAccessModel(undefined, corpus);
    expect(model.enabled).toBe(false);
    expect(Object.keys(model.classes)).toEqual([MEMBERS_CLASS]);
    expect(new Set(Object.values(model.documents))).toEqual(
      new Set([MEMBERS_CLASS]),
    );
    expect(documentClass(model, 'unknown')).toBe(MEMBERS_CLASS);
  });

  it('intersects the rules on a chain and closes what no rule covers', () => {
    const model = computeAccessModel(access, corpus);
    const team = model.documents['doc-team'] as string;
    const leads = model.documents['doc-leads'] as string;

    expect(model.documents['doc-open']).toBe(MEMBERS_CLASS);
    expect(model.classes[team]?.readers).toEqual([
      'leads@example.com',
      'team@example.com',
    ]);
    // A group the folder above does not name admits no one below it.
    expect(model.classes[leads]?.readers).toEqual(['leads@example.com']);
    expect(model.documents['doc-root']).toBe(ADMINS_CLASS);
    expect(model.documents['doc-unruled']).toBe(ADMINS_CLASS);
    // A document whose folder is unknown is closed, not guessed.
    expect(model.documents['doc-orphan']).toBe(ADMINS_CLASS);
    expect(folderClass(model, 'team-sub')).toBe(team);
    expect(documentClass(model, 'written-later')).toBe(ADMINS_CLASS);
  });

  it('closes a chain whose intersection is empty', () => {
    const model = computeAccessModel(
      {
        admins: ['admins@example.com'],
        rules: [
          { folder: 'team', label: 'Team', readers: ['team@example.com'] },
          {
            folder: 'team-narrow',
            label: 'Leads',
            readers: ['outsiders@example.com'],
          },
        ],
      },
      corpus,
    );
    expect(model.documents['doc-leads']).toBe(ADMINS_CLASS);
  });

  it('opens the whole corpus with a rule on the root', () => {
    const model = computeAccessModel(
      {
        admins: ['admins@example.com'],
        rules: [{ folder: 'root', label: 'Root', readers: ['*'] }],
      },
      corpus,
    );
    expect(model.documents['doc-root']).toBe(MEMBERS_CLASS);
    expect(model.documents['doc-unruled']).toBe(MEMBERS_CLASS);
  });

  it('is a pure function of its input', () => {
    expect(JSON.stringify(computeAccessModel(access, corpus))).toBe(
      JSON.stringify(computeAccessModel(access, corpus)),
    );
  });
});

describe('classIdentifiers', () => {
  const groupSet = fc.uniqueArray(
    fc.stringMatching(/^[a-z]{1,8}@example\.com$/u),
    { minLength: 1, maxLength: 4 },
  );

  it('ignores the order of reader sets and is unique per set', () => {
    fc.assert(
      fc.property(fc.uniqueArray(groupSet, { maxLength: 12 }), (raw) => {
        const sets = raw.map((groups) => [...groups].sort());
        const forward = classIdentifiers(sets);
        const backward = classIdentifiers([...sets].reverse());
        expect([...forward].sort()).toEqual([...backward].sort());
        expect(new Set(forward.values()).size).toBe(forward.size);
        for (const id of forward.values()) {
          expect(id).toMatch(/^[0-9a-f]{8,64}$/u);
        }
      }),
    );
  });

  it('never lets a rule below widen what a rule above allows', () => {
    fc.assert(
      fc.property(groupSet, groupSet, (above, below) => {
        const model = computeAccessModel(
          {
            admins: ['admins@example.com'],
            rules: [
              { folder: 'team', label: 'Team', readers: [...above].sort() },
              {
                folder: 'team-narrow',
                label: 'Leads',
                readers: [...below].sort(),
              },
            ],
          },
          corpus,
        );
        const id = model.documents['doc-leads'] as string;
        const readers = model.classes[id]?.readers ?? [];
        for (const group of readers) {
          expect(above).toContain(group);
          expect(below).toContain(group);
        }
      }),
    );
  });
});

describe('published readers', () => {
  it('never lets a document reach beyond the readers it was published with', () => {
    const narrowed = parseCorpusStructure({
      rootFolderId: 'root',
      folders: {
        root: { googleParentId: null, googleName: 'R', displayLabel: 'R' },
        open: {
          googleParentId: 'root',
          googleName: 'Open',
          displayLabel: 'Open',
        },
      },
      documents: {
        moved: {
          googleParentId: 'open',
          stableSlug: 'open/moved',
          publishedReaders: ['team@example.com'],
        },
        never: {
          googleParentId: 'open',
          stableSlug: 'open/never',
          publishedReaders: [],
        },
      },
    });
    const model = computeAccessModel(
      {
        admins: ['admins@example.com'],
        rules: [{ folder: 'open', label: 'Open', readers: ['*'] }],
      },
      narrowed,
    );
    const moved = model.documents.moved as string;
    expect(model.classes[moved]?.readers).toEqual(['team@example.com']);
    expect(model.documents.never).toBe(ADMINS_CLASS);
  });

  it('compares and intersects reader sets', () => {
    expect(widensReaders('*', ['a@example.com'])).toBe(true);
    expect(widensReaders(['a@example.com'], '*')).toBe(false);
    expect(
      widensReaders(['a@example.com', 'b@example.com'], ['a@example.com']),
    ).toBe(true);
    expect(widensReaders([], ['a@example.com'])).toBe(false);
    expect(intersectReaders('*', ['a@example.com'])).toEqual(['a@example.com']);
  });
});

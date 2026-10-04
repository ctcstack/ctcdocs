import {
  accessFindings,
  computeAccessModel,
  parseCorpusStructure,
  type AccessConfiguration,
} from '@ctcstack/ctcdocs-core';
import { describe, expect, it } from 'vitest';

import {
  buildAccessReview,
  type AccessReview,
  type ReviewFolder,
} from './access-review-view.js';

const folder = (parent: string | null, label: string, slug?: string) => ({
  googleParentId: parent,
  googleName: label,
  displayLabel: label,
  ...(slug ? { stableSlug: slug } : {}),
});

const document = (
  parent: string | null,
  slug: string,
  title: string,
  extra: Record<string, unknown> = {},
) => ({
  googleParentId: parent,
  stableSlug: slug,
  displayTitle: title,
  ...extra,
});

const corpus = parseCorpusStructure({
  rootFolderId: 'root',
  folders: {
    root: folder(null, 'Shared'),
    open: folder('root', 'Open', 'open'),
    team: folder('open', 'Team', 'open/team'),
    reference: folder('root', 'Reference', 'reference'),
    guides: folder('reference', 'Guides', 'reference/guides'),
    loose: folder('root', 'Loose', 'loose'),
  },
  documents: {
    start: document(null, 'start', 'Start here'),
    welcome: document('open', 'open/welcome', 'Welcome'),
    // Published to the team before its readers were widened by a rule; the
    // next sync brings it up to its folder.
    roster: document('open', 'open/roster', 'Roster', {
      publishedReaders: ['team@example.com'],
    }),
    plan: document('team', 'open/team/plan', 'Plan'),
    api: document('reference', 'reference/api', 'API'),
    // Moved here from the guides, which writers alone read: it keeps them.
    tone: document('reference', 'reference/tone', 'Tone', {
      publishedReaders: ['writers@example.com'],
      readersHeld: { chain: ['reference', 'root'], rules: '0123456789abcdef' },
    }),
    style: document('guides', 'reference/guides/style', 'Style'),
    notes: document('loose', 'loose/notes', 'Notes'),
  },
});

const access: AccessConfiguration = {
  admins: ['admins@example.com'],
  rules: [
    { folder: 'open', label: 'Open', readers: ['*'] },
    { folder: 'team', label: 'Team', readers: ['team@example.com'] },
    {
      folder: 'reference',
      label: 'Reference',
      readers: ['engineering@example.com', 'writers@example.com'],
    },
    {
      folder: 'guides',
      label: 'Style guides',
      readers: ['designers@example.com', 'writers@example.com'],
    },
  ],
};

/** The sidebar puts the reference first, then the open folder, then the rest. */
const order = new Map(
  [
    'reference/api',
    'reference/tone',
    'reference/guides/style',
    'open/welcome',
    'open/team/plan',
    'open/roster',
    'start',
    'loose/notes',
  ].map((slug, index) => [slug, index]),
);

function review(
  rules: AccessConfiguration = access,
  folderPages: ReadonlySet<string> = new Set(['reference', 'reference/guides']),
): AccessReview {
  return buildAccessReview({
    access: rules,
    model: computeAccessModel(rules, corpus),
    corpus,
    findings: accessFindings(rules, corpus),
    order,
    folderPages,
  });
}

/** The rules, with the one on `folder` replaced. */
function withRule(
  folder: string,
  rule: AccessConfiguration['rules'][number] | undefined,
): AccessConfiguration {
  return {
    ...access,
    rules: [
      ...access.rules.filter((entry) => entry.folder !== folder),
      ...(rule ? [rule] : []),
    ],
  };
}

function row(view: AccessReview, id: string): ReviewFolder {
  const found = view.folders.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`No row for ${id}`);
  }
  return found;
}

describe('buildAccessReview', () => {
  it('lists the folders depth first, in the order the sidebar has them', () => {
    const view = review();
    expect(
      view.folders.map(({ id, depth, parent }) => [id, depth, parent]),
    ).toEqual([
      ['root', 0, null],
      ['reference', 0, null],
      ['guides', 1, 'reference'],
      ['open', 0, null],
      ['team', 1, 'open'],
      ['loose', 0, null],
    ]);
    expect(row(view, 'root')).toMatchObject({
      root: true,
      documents: 8,
      hasChildren: false,
    });
    expect(row(view, 'reference')).toMatchObject({
      hasChildren: true,
      documents: 3,
      href: '/reference/',
      drive: 'https://drive.google.com/drive/folders/reference',
    });
    expect(row(view, 'open').href).toBe(undefined);
    expect(row(view, 'reference').direct.map((entry) => entry.title)).toEqual([
      'API',
      'Tone',
    ]);
  });

  it('names every group a rule names, and the admin groups apart', () => {
    const view = review();
    expect(view.groups).toEqual([
      'designers@example.com',
      'engineering@example.com',
      'team@example.com',
      'writers@example.com',
    ]);
    expect(view.admins).toEqual(['admins@example.com']);
  });

  it('marks how each group comes to read a folder, or why it does not', () => {
    const view = review();
    expect(row(view, 'reference')).toMatchObject({
      readers: ['engineering@example.com', 'writers@example.com'],
      reach: 'groups',
      everyMember: 'none',
      groups: {
        'designers@example.com': 'none',
        'engineering@example.com': 'here',
        'team@example.com': 'none',
        'writers@example.com': 'here',
      },
    });
    expect(row(view, 'guides').ruledBy).toEqual(['reference', 'guides']);
    expect(row(view, 'loose').ruledBy).toEqual([]);
    // A group the rule names that the rule above does not admits no one.
    expect(row(view, 'guides')).toMatchObject({
      readers: ['writers@example.com'],
      groups: {
        'designers@example.com': 'blocked',
        'engineering@example.com': 'none',
        'writers@example.com': 'here',
      },
    });
    // Every member reads it; no group needs a mark of its own.
    expect(row(view, 'open')).toMatchObject({
      classId: 'members',
      readers: '*',
      reach: 'members',
      everyMember: 'here',
      groups: { 'team@example.com': 'none' },
    });
    // A rule below every member narrows to its group.
    expect(row(view, 'team')).toMatchObject({
      readers: ['team@example.com'],
      everyMember: 'none',
      groups: { 'team@example.com': 'here' },
    });
  });

  it('says why a folder is open to admins only, and offers the rule to add', () => {
    const view = review();
    expect(row(view, 'loose')).toMatchObject({
      classId: 'admins',
      reach: 'admins',
      closed: 'no-rule',
      ruleToAdd: { folder: 'loose', label: 'Loose', readers: [] },
    });
    expect(row(view, 'root')).toMatchObject({
      reach: 'admins',
      closed: 'no-rule',
      ruleToAdd: { folder: 'root', label: 'Shared', readers: [] },
    });
    // Its folders inherit no rule, but the rule is offered where it is
    // reported, not on every folder below.
    expect(row(view, 'reference').ruleToAdd).toBe(undefined);

    const narrowed = review(
      withRule('guides', {
        folder: 'guides',
        label: 'Guides',
        readers: ['designers@example.com'],
      }),
    );
    expect(row(narrowed, 'guides')).toMatchObject({
      reach: 'admins',
      closed: 'no-reader',
    });
  });

  it('names a document with fewer readers than its folder, and why', () => {
    const view = review();
    const tone = row(view, 'reference').direct.find(
      (entry) => entry.id === 'tone',
    );
    expect(tone).toMatchObject({
      readers: ['writers@example.com'],
      reach: 'groups',
      narrower: 'move',
    });
    const roster = row(view, 'open').direct.find(
      (entry) => entry.id === 'roster',
    );
    expect(roster).toMatchObject({
      readers: ['team@example.com'],
      narrower: 'sync',
    });
    // A document narrower than its folder is in a class of its own, which
    // the status route counts apart.
    expect(roster?.classId).toBe(row(view, 'team').classId);
    expect(roster?.classId).not.toBe(row(view, 'open').classId);
    const api = row(view, 'reference').direct.find(
      (entry) => entry.id === 'api',
    );
    expect(api?.narrower).toBe(undefined);
  });

  it('counts every document once by who may read it', () => {
    expect(review().documents).toEqual({
      members: 1,
      groups: 5,
      admins: 2,
      total: 8,
    });
  });

  it('puts what changes who reads first, and notes after', () => {
    const view = review(
      withRule('gone', { folder: 'gone', label: 'Gone', readers: ['*'] }),
    );
    expect(
      view.attention.map((item) =>
        item.kind === 'finding'
          ? `${item.tone}:${item.finding.code}:${item.finding.folder}`
          : `${item.tone}:narrower:${item.document.id}`,
      ),
    ).toEqual([
      'warning:folder-without-rule:loose',
      'warning:folder-without-rule:root',
      'warning:narrower:tone',
      'warning:rule-group-not-admitted-above:guides',
      'note:narrower:roster',
      'note:rule-folder-missing:gone',
      'note:rule-label-outdated:guides',
    ]);
  });

  it('is the same for the same input', () => {
    expect(JSON.stringify(review())).toBe(JSON.stringify(review()));
  });
});

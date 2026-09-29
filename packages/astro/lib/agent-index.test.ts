import { describe, expect, it } from 'vitest';

import {
  buildAgentIndex,
  renderSectionIndex,
  renderSiteIndex,
  type IndexedDocument,
  type NavigationItem,
} from './agent-index.js';

const site = {
  title: 'Example [DOCS]',
  description: 'Synthetic documentation\nfor tests',
};

const documents = new Map<string, IndexedDocument>([
  ['start-here', { title: 'Start here', description: undefined, pdf: false }],
  [
    'handbook/overview',
    {
      title: 'Overview',
      description: '  How the\n handbook works. ',
      pdf: false,
    },
  ],
  [
    'handbook/policies/leave',
    { title: 'Leave *policy*', description: '', pdf: false },
  ],
  ['reference/api', { title: 'API', description: 'Endpoints.', pdf: true }],
  ['orphan', { title: 'Orphan', description: undefined, pdf: false }],
  [
    'another-orphan',
    { title: 'Another orphan', description: undefined, pdf: false },
  ],
]);

const navigation: NavigationItem[] = [
  { label: 'General', items: [{ label: 'Start here', slug: 'start-here' }] },
  {
    label: 'Handbook/',
    items: [
      {
        label: 'Policies',
        items: [{ label: 'Leave', slug: 'handbook/policies/leave' }],
      },
      { label: 'Overview', slug: 'handbook/overview', badge: 'New' },
      { label: 'Handbook', slug: 'handbook' },
    ],
  },
  {
    label: 'Reference',
    items: ['reference/api', { label: 'Elsewhere', link: 'https://a.test' }],
  },
  { label: 'Empty', items: [{ label: 'Archive', items: [] }] },
];

const sectionPages = new Map([
  ['Handbook', '/handbook/'],
  ['Handbook\u0000Policies', '/handbook/policies/'],
]);

function sectionHref(trail: readonly string[]): string | undefined {
  return sectionPages.get(trail.join('\u0000'));
}

describe('agent index', () => {
  const sections = buildAgentIndex(navigation, documents, sectionHref);

  it('follows the navigation and drops what is not a document', () => {
    expect(sections.map((section) => section.trail)).toEqual([
      ['General'],
      ['Handbook'],
      ['Reference'],
      ['Other documents'],
    ]);
    const handbook = sections[1];
    expect(handbook?.documents.map((entry) => entry.slug)).toEqual([
      'handbook/overview',
    ]);
    expect(handbook?.children[0]?.trail).toEqual(['Handbook', 'Policies']);
  });

  it('gives only a top-level folder with a page an index of its own', () => {
    expect(sections.map((section) => section.indexPath)).toEqual([
      undefined,
      '/handbook/llms.txt',
      undefined,
      undefined,
    ]);
    expect(sections[1]?.children[0]?.indexPath).toBeUndefined();
  });

  it('files documents the navigation misses at the end, in a stable order', () => {
    expect(sections.at(-1)?.documents.map((entry) => entry.slug)).toEqual([
      'another-orphan',
      'orphan',
    ]);
  });

  it('lists every document once in the site index', () => {
    const index = renderSiteIndex(site, sections);

    expect(index).toBe(`# Example \\[DOCS\\]

> Synthetic documentation for tests

Every document on this site, in the order its navigation shows them. Each link is the document's Markdown version: its page address plus \`index.md\`. A top-level section with an index of its own links to it first.

## General

- [Start here](/start-here/index.md)

## Handbook

- [Handbook: section index](/handbook/llms.txt): Every document in this section, on its own.
- [Overview](/handbook/overview/index.md): How the handbook works.

## Handbook / Policies

- [Leave \\*policy\\*](/handbook/policies/leave/index.md)

## Reference

- [API (PDF)](/reference/api/index.md): Endpoints.

## Other documents

- [Another orphan](/another-orphan/index.md)
- [Orphan](/orphan/index.md)
`);
  });

  it('renders a section index that points back to the whole site', () => {
    const handbook = sections[1];
    if (!handbook) throw new Error('missing section');
    const index = renderSectionIndex(site, handbook);

    expect(index).toBe(`# Handbook

> Every document in this section of Example \\[DOCS\\].

The documents are in the order the navigation shows them. Each link is the document's Markdown version: its page address plus \`index.md\`. The index of the whole site is [/llms.txt](/llms.txt).

## Handbook

- [Overview](/handbook/overview/index.md): How the handbook works.

## Handbook / Policies

- [Leave \\*policy\\*](/handbook/policies/leave/index.md)
`);
  });

  it('files top-level links under a heading of their own', () => {
    const loose = buildAgentIndex(
      ['start-here', { label: 'Handbook', items: ['handbook/overview'] }],
      documents,
      () => undefined,
    );

    expect(loose.map((section) => section.trail)).toEqual([
      ['Documents'],
      ['Handbook'],
      ['Other documents'],
    ]);
  });

  it('gives a folder page index to the first of two folders sharing a name', () => {
    const twins = buildAgentIndex(
      [
        { label: 'Handbook', items: ['handbook/overview'] },
        { label: 'Handbook', items: ['handbook/policies/leave'] },
      ],
      documents,
      sectionHref,
    );

    expect(twins.slice(0, 2).map((section) => section.indexPath)).toEqual([
      '/handbook/llms.txt',
      undefined,
    ]);
    expect(renderSiteIndex(site, twins)).toContain(
      '(/handbook/policies/leave/index.md)',
    );
  });

  it('produces the same bytes for the same corpus', () => {
    const again = buildAgentIndex(navigation, documents, sectionHref);
    expect(renderSiteIndex(site, again)).toBe(renderSiteIndex(site, sections));
  });
});

import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildSearchCases,
  casesByBundle,
  isTitleAlone,
  resultPath,
  sitePathOf,
  unindexedElements,
  withoutUnindexed,
} from './verify-search.mjs';

const documentOf = (title, slug) => ({ title, slug });

test('a title is split on punctuation rather than stripped of it', () => {
  /*
   * The corpus this regressed on named documents `Prefix_Team_2026 Roles &
   * Structure`. Deleting the underscores produced the single term
   * `PrefixTeam2026`, which no index holds, and the check declared a document
   * unfindable that the search interface finds on the first result.
   */
  assert.deepEqual(
    buildSearchCases([
      documentOf('Prefix_Team_2026 Roles & Structure', 'teams/roles'),
    ]),
    [['Prefix Team Roles Structure', '/teams/roles/']],
  );
  assert.deepEqual(
    buildSearchCases([documentOf('Handbook_AI Policy', 'policies/ai')]),
    [['Handbook Policy', '/policies/ai/']],
  );
  assert.deepEqual(
    buildSearchCases([documentOf('Quarterly review final.docx', 'review')]),
    [['Quarterly review final docx', '/review/']],
  );
});

test('a hyphenated word stays one term', () => {
  assert.deepEqual(
    buildSearchCases([documentOf('Multi-region failover', 'failover')]),
    [['Multi-region failover', '/failover/']],
  );
});

test('ordering prefixes and short words are not evidence of indexing', () => {
  assert.deepEqual(
    buildSearchCases([
      documentOf('03 — Onboarding for new hires', 'onboarding'),
    ]),
    [['Onboarding hires', '/onboarding/']],
  );
});

test('a document the check cannot search for is skipped, not failed', () => {
  assert.deepEqual(
    buildSearchCases([
      documentOf('01 — 2026', 'numbers'),
      documentOf('', 'empty'),
      documentOf('Deployment runbook', undefined),
      documentOf('Deployment runbook', 'runbook'),
    ]),
    [['Deployment runbook', '/runbook/']],
  );
});

test('the first document of each format is searched for', () => {
  const documents = [
    ...Array.from({ length: 6 }, (_, index) => ({
      ...documentOf(`Document number ${index}`, `document-${index}`),
      format: 'google-doc',
    })),
    { ...documentOf('Release checklist', 'checklist'), format: 'pdf' },
  ];
  const cases = buildSearchCases(documents);
  assert.equal(cases.length, 5);
  assert.deepEqual(cases[1], ['Release checklist', '/checklist/']);
});

test('at most five documents are searched for', () => {
  const documents = Array.from({ length: 8 }, (_, index) =>
    documentOf(`Document number ${index}`, `document-${index}`),
  );
  assert.equal(buildSearchCases(documents).length, 5);
});

test('a non-Latin title survives the split', () => {
  assert.deepEqual(
    buildSearchCases([documentOf('Рабочие_заметки команды', 'notes')]),
    [['Рабочие заметки команды', '/notes/']],
  );
});

test('a result for a non-ASCII slug matches the slug the corpus records', () => {
  /*
   * A Drive title typed with a Cyrillic `С` produced the slug
   * `сompany-handbook`. Pagefind returned it percent-encoded
   * and the check reported it missing while search found it first.
   */
  assert.equal(
    resultPath('/team/%D1%81ompany-handbook/'),
    '/team/сompany-handbook/',
  );
  assert.equal(resultPath('/runbook/'), '/runbook/');
  assert.equal(
    resultPath(
      'https://docs.example/notes/%D0%B7%D0%B0%D0%BC%D0%B5%D1%82%D0%BA%D0%B8/',
    ),
    '/notes/заметки/',
  );
});

test('a document with a non-ASCII slug is always searched for', () => {
  const documents = [
    ...Array.from({ length: 6 }, (_, index) =>
      documentOf(`Document number ${index}`, `document-${index}`),
    ),
    documentOf('Рабочие заметки', 'рабочие-заметки'),
  ];
  const cases = buildSearchCases(documents);
  assert.equal(cases.length, 5);
  assert.deepEqual(cases[0], ['Рабочие заметки', '/рабочие-заметки/']);
});

const page = (body) =>
  `<html><body><header data-ctcdocs-unindexed="header">Site</header><main data-pagefind-body>${body}</main></body></html>`;

test('a marked element is excluded by its own attribute or an ancestor', () => {
  assert.deepEqual(
    unindexedElements(
      page(
        '<div data-ctcdocs-unindexed="row" data-pagefind-ignore>Copy</div>' +
          '<div data-pagefind-ignore="all"><p data-ctcdocs-unindexed="nested">List</p></div>',
      ),
    ),
    [
      { excluded: true, name: 'row' },
      { excluded: true, name: 'nested' },
    ],
  );
});

test('a marked element without the attribute is reported on its own page', () => {
  /*
   * One page losing the attribute is a leak whatever the other pages do. A
   * check that asked only whether some page still excluded the text let a
   * partial loss through.
   */
  assert.deepEqual(
    unindexedElements(
      page(
        '<div data-ctcdocs-unindexed="row" data-pagefind-ignore>Copy</div>' +
          '<div data-ctcdocs-unindexed="row">Copy</div>',
      ),
    ),
    [
      { excluded: true, name: 'row' },
      { excluded: false, name: 'row' },
    ],
  );
});

test('only the attribute counts as exclusion', () => {
  // Pagefind skips `nav` by default, but a marked element that relies on that
  // would pass here while the attribute it is checking is gone.
  assert.deepEqual(
    unindexedElements(page('<nav data-ctcdocs-unindexed="trail">Home</nav>')),
    [{ excluded: false, name: 'trail' }],
  );
});

test('a marked element outside the indexed part is not reported', () => {
  assert.deepEqual(unindexedElements(page('<p>Body</p>')), []);
  assert.deepEqual(
    unindexedElements(
      '<html><body><div data-ctcdocs-unindexed="row">Copy</div></body></html>',
    ),
    [],
  );
});

test('the page compared against has every marked element removed', () => {
  const stripped = withoutUnindexed(
    page(
      '<h1>Title</h1><div data-ctcdocs-unindexed="row" data-pagefind-ignore>Copy</div><p>Body</p>',
    ),
  );
  assert.doesNotMatch(stripped, /data-ctcdocs-unindexed|Copy|Site/u);
  assert.match(stripped, /<h1>Title<\/h1><p>Body<\/p>/u);
});

test('a built file maps to the path a Pagefind result reports', () => {
  assert.equal(sitePathOf('index.html'), '/');
  assert.equal(
    sitePathOf(join('handbook', 'runbook', 'index.html')),
    '/handbook/runbook/',
  );
  assert.equal(
    sitePathOf(join('notes', 'заметки', 'index.html')),
    '/notes/заметки/',
  );
  assert.equal(sitePathOf('404.html'), '/404.html');
});

test('a document is searched for in the bundle of its own class', () => {
  const groups = casesByBundle(
    [
      ['Open guide', '/open/guide/'],
      ['Team plan', '/team/plan/'],
      ['Unmapped page', '/elsewhere/'],
    ],
    {
      files: { '/open/guide/': 'members', '/team/plan/': '0a1b2c3d' },
      bundles: { members: '/pagefind/', '0a1b2c3d': '/pagefind-0a1b2c3d/' },
    },
  );
  assert.deepEqual(
    [...groups],
    [
      [
        '/pagefind/',
        [
          ['Open guide', '/open/guide/', 'members'],
          ['Unmapped page', '/elsewhere/', 'members'],
        ],
      ],
      ['/pagefind-0a1b2c3d/', [['Team plan', '/team/plan/', '0a1b2c3d']]],
    ],
  );
});

test('a class without a bundle fails the check', () => {
  assert.throws(
    () =>
      casesByBundle([['Team plan', '/team/plan/']], {
        files: { '/team/plan/': 'admins' },
        bundles: { members: '/pagefind/' },
      }),
    /names no search bundle/u,
  );
});

test('the home page may be indexed with the full stop Pagefind adds', () => {
  assert.equal(isTitleAlone('Example Docs.', 'Example Docs'), true);
  assert.equal(isTitleAlone('Example [DOCS]', 'Example [DOCS]'), true);
  assert.equal(isTitleAlone('Example Docs. Recent', 'Example Docs'), false);
  assert.equal(isTitleAlone('Example', 'Example Docs'), false);
});

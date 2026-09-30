import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildSearchCases,
  phrasePlacement,
  resultPath,
  sitePathOf,
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
  `<html><body><header>Site header</header><main data-pagefind-body>${body}</main></body></html>`;

test('a phrase only inside an ignored element is chrome', () => {
  assert.equal(
    phrasePlacement(
      page(
        '<h1>Runbook</h1><div data-pagefind-ignore><a href="index.md">\n  View   as\n Markdown\n</a></div>',
      ),
      'View as Markdown',
    ),
    'ignored',
  );
});

test('a phrase the document itself contains is content', () => {
  assert.equal(
    phrasePlacement(
      page(
        '<div data-pagefind-ignore>View as Markdown</div><p>Choose view as Markdown to copy it.</p>',
      ),
      'View as Markdown',
    ),
    'content',
  );
});

test('a phrase the index never reads is not a placement', () => {
  /*
   * Outside the indexed body, in a script, or on a page with no indexed body
   * at all, the phrase is absent from the index whether or not exclusion
   * works. Counting any of these would let the check pass without testing it.
   */
  assert.equal(
    phrasePlacement(
      '<html><body><header>View as Markdown</header><main data-pagefind-body><p>Body</p></main></body></html>',
      'View as Markdown',
    ),
    undefined,
  );
  assert.equal(
    phrasePlacement(
      page('<p>Body</p><script>const label = "View as Markdown";</script>'),
      'View as Markdown',
    ),
    undefined,
  );
  assert.equal(
    phrasePlacement(
      '<html><body><div data-pagefind-ignore>View as Markdown</div></body></html>',
      'View as Markdown',
    ),
    undefined,
  );
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

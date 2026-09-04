import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSearchCases } from './verify-search.mjs';

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

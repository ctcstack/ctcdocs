import { describe, expect, it } from 'vitest';

import { accessFindings } from './access-findings.js';
import { parseCorpusStructure } from './corpus-structure.js';

const corpus = parseCorpusStructure({
  rootFolderId: 'root',
  folders: {
    root: { googleParentId: null, googleName: 'Root', displayLabel: 'Root' },
    team: {
      googleParentId: 'root',
      googleName: '02 - Team',
      displayLabel: 'Team',
      stableSlug: 'team',
    },
    leads: {
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
    'unruled-sub': {
      googleParentId: 'unruled',
      googleName: 'Deeper',
      displayLabel: 'Deeper',
      stableSlug: 'unruled/deeper',
    },
  },
  documents: {
    a: { googleParentId: 'root', stableSlug: 'a' },
    b: { googleParentId: 'unruled', stableSlug: 'unruled/b' },
    c: { googleParentId: 'unruled-sub', stableSlug: 'unruled/deeper/c' },
    d: { googleParentId: 'leads', stableSlug: 'team/leads/d' },
  },
});

describe('accessFindings', () => {
  it('names every place a rule is missing, outdated or ineffective', () => {
    const findings = accessFindings(
      {
        admins: ['admins@example.com'],
        rules: [
          { folder: 'team', label: '02 - Team', readers: ['team@example.com'] },
          {
            folder: 'leads',
            label: 'Team leads',
            readers: ['leads@example.com', 'team@example.com'],
          },
          { folder: 'archived', label: 'Archive', readers: ['*'] },
        ],
      },
      corpus,
    );

    expect(findings).toEqual([
      {
        code: 'folder-without-rule',
        documents: 1,
        folder: 'root',
        name: 'Root',
        trail: [],
      },
      {
        code: 'folder-without-rule',
        documents: 2,
        folder: 'unruled',
        name: 'Unruled',
        trail: [],
      },
      {
        code: 'rule-group-not-admitted-above',
        folder: 'leads',
        groups: ['leads@example.com'],
        label: 'Team leads',
        name: 'Leads',
        trail: ['Team'],
      },
      { code: 'rule-folder-missing', folder: 'archived', label: 'Archive' },
      {
        code: 'rule-label-outdated',
        folder: 'leads',
        label: 'Team leads',
        name: 'Leads',
        trail: ['Team'],
      },
    ]);
  });

  it('accepts a label that matches the Drive name or the shown name', () => {
    const findings = accessFindings(
      {
        admins: ['admins@example.com'],
        rules: [
          { folder: 'root', label: 'Root', readers: ['*'] },
          { folder: 'team', label: 'Team', readers: ['team@example.com'] },
          { folder: 'unruled', label: 'Unruled', readers: ['*'] },
        ],
      },
      corpus,
    );
    expect(findings).toEqual([]);
  });
});

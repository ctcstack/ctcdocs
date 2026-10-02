import { describe, expect, it } from 'vitest';

import { NOTE_KINDS } from '../generation/notes.js';
import type { SyncReport } from '../generation/sync-report.js';
import { UNPUBLISHED_REASONS } from '../generation/unpublished.js';
import { readSourceTitle } from '../titles/source-title.js';
import { createTitleReport } from '../titles/title-report.js';
import {
  renderAccessSummary,
  renderContentHealthSummary,
  renderFailureSummary,
  renderRunSummary,
  renderSiteSummary,
} from './sync-summary.js';

const site = 'https://docs.example.com';
const pageUrl = `${site}/content-health/`;

function syncReport(overrides: Partial<SyncReport> = {}): SyncReport {
  return {
    schemaVersion: 3,
    generatedAt: '2026-07-31T10:00:00.000Z',
    dryRun: false,
    summary: {
      exported: 12,
      added: 2,
      changed: 3,
      unchanged: 4,
      removed: 1,
      folders: 5,
      unsupported: 6,
      warnings: 7,
      notPublished: 8,
      outOfDate: 9,
      incomplete: 11,
      ignored: 10,
      published: { googleDocs: 40, pdfs: 2 },
      conversion: { markdown: 25, html: 15 },
      notes: 0,
    },
    reasons: [...UNPUBLISHED_REASONS],
    unpublished: [],
    ignoredFolders: [],
    noteKinds: [...NOTE_KINDS],
    notes: [],
    ...overrides,
  };
}

const file = {
  id: 'file-one',
  name: 'Budget.xlsx',
  folderPath: ['Team', 'Finance'],
  type: 'Excel workbook',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  status: 'not-published' as const,
  reason: 'spreadsheet-file' as const,
  sourceUrl: 'https://drive.google.com/open?id=file-one',
  lastEditedBy: 'Editor One',
};

describe('renderRunSummary', () => {
  const run = {
    exported: 3,
    dryRun: false,
    full: false,
    outputChanged: true,
  };

  it('says so when the run changed nothing on the site', () => {
    const summary = renderRunSummary(
      {
        ...run,
        outputChanged: false,
        changes: { added: [], changed: [], removed: [], moved: [] },
      },
      site,
    );

    expect(summary).toContain('**Nothing on the site changed.**');
    expect(summary).toContain('3 documents exported from Google');
    expect(summary).toContain('Generated output changed: no');
  });

  it('links every page it added or changed, and names what it removed', () => {
    const summary = renderRunSummary(
      {
        ...run,
        changes: {
          added: [
            {
              id: 'a',
              title: 'Handbook [draft]',
              slug: 'team/рабочие-заметки',
              format: 'pdf',
            },
          ],
          changed: [
            { id: 'b', title: 'Guide', slug: 'guide', format: 'google-doc' },
          ],
          removed: [
            { id: 'c', title: 'Old', slug: 'old', format: 'google-doc' },
          ],
          moved: [{ title: 'Guide', from: 'team/guide', to: 'guide' }],
        },
      },
      site,
    );

    expect(summary).toContain(
      '**1 page added, 1 changed, 1 removed, 1 address moved.**',
    );
    expect(summary).toContain(
      `- [Handbook \\[draft\\]](${site}/team/${encodeURIComponent('рабочие-заметки')}/) · PDF`,
    );
    expect(summary).toContain(`- [Guide](${site}/guide/)`);
    expect(summary).toContain('- Old');
    expect(summary).toContain('| Guide | /team\\/guide/ | /guide/ |');
  });
});

describe('renderSiteSummary', () => {
  it('opens with what is on the site and what is not', () => {
    const summary = renderSiteSummary(syncReport(), pageUrl);

    expect(summary).toContain(
      '**On the site: 42 pages** — 40 Google Docs, 2 PDFs. **Not on the site: 8** · out of date: 9 · incomplete: 11 · notes: 0.',
    );
    expect(summary).toContain(`[content health page](${pageUrl})`);
    expect(summary).toContain(
      'Every file in the published folders is on the site.',
    );
    expect(summary).toContain('Nothing to note');
    expect(summary).toContain(
      "25 Google Docs from Google's Markdown export, 15 through its HTML export",
    );
  });

  it('groups files by what to do, with where they are and the list folded', () => {
    const summary = renderSiteSummary(
      syncReport({
        unpublished: [
          file,
          { ...file, id: 'file-two', folderPath: ['Team'] },
          { ...file, id: 'file-three', folderPath: [] },
          {
            ...file,
            id: 'video',
            name: 'Demo.mp4',
            type: 'Video (MP4)',
            reason: 'media-file',
          },
        ],
      }),
      pageUrl,
    );

    expect(summary).toContain(
      '| Spreadsheets | 3 | Team (2), General (1) | Link from a document |',
    );
    expect(summary).toContain(
      '| Video and audio | 1 | Team (1) | Link from a document |',
    );
    // Spreadsheets come after video in the catalog, and so in the summary.
    expect(summary.indexOf('<b>Spreadsheets</b> — 3')).toBeGreaterThan(
      summary.indexOf('| Video and audio |'),
    );
    expect(summary).toContain(
      '| Team › Finance | [Budget\\.xlsx](https://drive.google.com/open?id=file-one) | Excel workbook | Not on the site | Editor One |',
    );
  });

  it('keeps a hostile name literal and inside its cell', () => {
    const summary = renderSiteSummary(
      syncReport({
        unpublished: [
          {
            ...file,
            name: '[click](https://evil.example) | <img src=x>\nnext',
          },
        ],
      }),
      pageUrl,
    );
    const line = summary
      .split('\n')
      .find((candidate) => candidate.startsWith('| Team › Finance'));

    expect(line).toContain(
      '\\[click\\]\\(https\\:\\/\\/evil\\.example\\) \\| \\<img src\\=x\\> next',
    );
    expect(line?.split(' | ')).toHaveLength(5);
  });

  it('lists notes by kind, and ignored folders', () => {
    const summary = renderSiteSummary(
      syncReport({
        notes: [
          {
            id: 'doc',
            name: 'Plan',
            folderPath: ['Team'],
            type: 'Google Docs',
            sourceUrl: 'https://docs.google.com/document/d/doc/edit',
            lastEditedBy: null,
            slug: 'team/plan',
            note: 'duplicate-name',
            detail: 'Also in this folder: “Plan.pdf” (PDF)',
          },
        ],
        ignoredFolders: [
          { id: 'drafts', name: 'Drafts', folderPath: ['Team'], items: 4 },
        ],
      }),
      pageUrl,
    );

    expect(summary).toContain('### Notes — 1');
    expect(summary).toContain(
      '| Files in one folder share a name | 1 | Team (1) | Rename one, or remove it |',
    );
    expect(summary).toContain('Also in this folder\\: “Plan\\.pdf” \\(PDF\\)');
    expect(summary).toContain('| Team › Drafts | 4 |');
  });

  it('lists at most a hundred files a group and points to the page for the rest', () => {
    const summary = renderSiteSummary(
      syncReport({
        unpublished: Array.from({ length: 105 }, (_, index) => ({
          ...file,
          id: `file-${index}`,
        })),
      }),
      pageUrl,
    );

    expect(
      summary.split('\n').filter((line) => line.startsWith('| Team › Finance')),
    ).toHaveLength(100);
    expect(summary).toContain('5 more on the page.');
  });
});

describe('renderFailureSummary', () => {
  it('says what failed, what it means and what to do', () => {
    const summary = renderFailureSummary('GOOGLE_PERMISSION', [
      'ERROR [GOOGLE_PERMISSION]: status=403 reason=insufficientFilePermissions',
    ]);

    expect(summary).toContain('## Sync failed');
    expect(summary).toContain('**Nothing was published.**');
    expect(summary).toContain('Viewer of the Shared Drive');
    expect(summary).toContain(
      'ERROR [GOOGLE_PERMISSION]: status=403 reason=insufficientFilePermissions',
    );
  });

  it('falls back for a failure it does not know, and keeps the block closed', () => {
    const summary = renderFailureSummary('SOMETHING_NEW', ['```breakout']);

    expect(summary).toContain('does not expect');
    expect(summary).not.toContain('```breakout');
  });
});

describe('renderContentHealthSummary', () => {
  it('counts documents per check and links to the page, naming none', () => {
    const report = createTitleReport([
      {
        id: 'secret-file-id',
        slug: 'team/confidential-plan',
        name: 'Copy of Confidential plan',
        title: 'Copy of Confidential plan',
        folderPath: ['Team'],
        lastEditedBy: 'Editor One',
        source: readSourceTitle([
          {
            paragraph: {
              paragraphStyle: { namedStyleType: 'HEADING_2' },
              elements: [{ textRun: { content: 'Сontacts' } }],
            },
          },
        ]),
        removedTitleHeading: false,
      },
    ]);

    const summary = renderContentHealthSummary(report, pageUrl);

    expect(summary).toContain('## Content health');
    expect(summary).toContain('| Fix | A heading mixes alphabets | 1 |');
    expect(summary).toContain(`[content health page](${pageUrl})`);
    for (const secret of [
      'Confidential',
      'secret-file-id',
      'Сontacts',
      'Editor One',
    ]) {
      expect(summary).not.toContain(secret);
    }
  });
});

describe('renderAccessSummary', () => {
  it('says nothing when every folder has a working rule', () => {
    expect(renderAccessSummary([], pageUrl)).toBe('');
  });

  it('lists closed folders and drifted rules with escaped names', () => {
    const summary = renderAccessSummary(
      [
        {
          code: 'folder-without-rule',
          documents: 3,
          folder: 'f-team',
          name: 'Team | Leads',
          trail: ['Company'],
        },
        {
          code: 'rule-group-not-admitted-above',
          folder: 'f-leads',
          groups: ['leads@example.com'],
          label: 'Leads',
          name: 'Leads',
          trail: ['Team'],
        },
        { code: 'rule-folder-missing', folder: 'f-gone', label: 'Archive' },
        {
          code: 'rule-label-outdated',
          folder: 'f-leads',
          label: 'Team leads',
          name: 'Leads',
          trail: ['Team'],
        },
      ],
      pageUrl,
    );
    expect(summary).toContain('## Folder access — 4');
    expect(summary).toContain(
      '| Closed, no rule | Company › Team \\| Leads | 3 documents readable by admins only until a rule names this folder |',
    );
    expect(summary).toContain(
      'leads\\@example\\.com not named by a rule above',
    );
    expect(summary).toContain(
      '| Rule for a missing folder | Archive `f-gone` |',
    );
    expect(summary).toContain('The rule calls it Team leads');
    expect(summary).toContain(`[content health page](${pageUrl})`);
  });
});

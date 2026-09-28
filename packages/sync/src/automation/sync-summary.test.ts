import { describe, expect, it } from 'vitest';

import { readSourceTitle } from '../titles/source-title.js';
import { createTitleReport } from '../titles/title-report.js';
import type { SyncReport } from '../generation/sync-report.js';
import { UNPUBLISHED_REASONS } from '../generation/unpublished.js';
import {
  renderContentHealthSummary,
  renderSyncJobSummary,
  renderUnpublishedSummary,
} from './sync-summary.js';

function syncReport(overrides: Partial<SyncReport> = {}): SyncReport {
  return {
    schemaVersion: 2,
    generatedAt: '2026-07-31T10:00:00.000Z',
    dryRun: false,
    summary: {
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
    },
    reasons: [...UNPUBLISHED_REASONS],
    unpublished: [],
    ignoredFolders: [],
    ...overrides,
  };
}

describe('renderSyncJobSummary', () => {
  it('renders aggregate counts without document content', () => {
    const summary = renderSyncJobSummary(syncReport(), true);

    expect(summary).toContain('Generated output changed: yes');
    expect(summary).toContain('| Added | 2 |');
    expect(summary).toContain('| Not on the site | 8 |');
    expect(summary).toContain('| Out of date on the site | 9 |');
    expect(summary).toContain('| Warnings | 7 |');
    expect(summary).not.toContain('document body');
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

    const summary = renderContentHealthSummary(
      report,
      'https://docs.example.com/content-health/',
    );

    expect(summary).toContain('## Content health');
    expect(summary).toContain('| Fix | A heading mixes alphabets | 1 |');
    expect(summary).toContain(
      '[content health page](https://docs.example.com/content-health/)',
    );
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

describe('renderUnpublishedSummary', () => {
  const pageUrl = 'https://docs.example.com/content-health/';
  const entry = {
    id: 'file-one',
    name: 'Budget',
    folderPath: ['Team'],
    type: 'Google Sheets',
    mimeType: 'application/vnd.google-apps.spreadsheet',
    status: 'not-published' as const,
    reason: 'unsupported-type' as const,
    sourceUrl: 'https://drive.google.com/open?id=file-one',
    lastEditedBy: null,
  };

  it('names each file with its folder, type and reason', () => {
    const summary = renderUnpublishedSummary(
      syncReport({
        unpublished: [
          entry,
          {
            ...entry,
            id: 'doc-two',
            name: 'Handbook',
            folderPath: [],
            type: 'Google Docs',
            status: 'out-of-date',
            reason: 'content-rejected',
            detail: 'SVG contains active or external content.',
            slug: 'handbook',
            publishedVersion: '2026-07-01T10:00:00.000Z',
          },
        ],
        ignoredFolders: [
          { id: 'drafts', name: 'Drafts', folderPath: ['Team'], items: 4 },
        ],
      }),
      pageUrl,
    );

    expect(summary).toContain('## Not on the site');
    expect(summary).toContain(`(${pageUrl}#not-on-the-site)`);
    expect(summary).toContain(
      '| Not on the site | The site does not publish this kind of file | Team | Budget | Google Sheets |',
    );
    expect(summary).toContain(
      '| Out of date on the site | The document holds something the site will not publish (SVG contains active or external content\\.) | General | Handbook | Google Docs |',
    );
    expect(summary).toContain('| Team › Drafts | 4 |');
  });

  it('keeps a hostile name literal and inside its cell', () => {
    const summary = renderUnpublishedSummary(
      syncReport({
        unpublished: [
          {
            ...entry,
            name: '[click](https://evil.example) | <img src=x>\nnext',
          },
        ],
      }),
      pageUrl,
    );
    const row = summary
      .split('\n')
      .find((line) => line.startsWith('| Not on the site'));

    expect(row).toContain(
      '\\[click\\]\\(https\\:\\/\\/evil\\.example\\) \\| \\<img src\\=x\\> next',
    );
    expect(row?.split(' | ')).toHaveLength(5);
  });

  it('says so when every file is on the site', () => {
    expect(renderUnpublishedSummary(syncReport(), pageUrl)).toContain(
      'Every file in the published folders is on the site.',
    );
  });

  it('lists at most two hundred files and points to the page for the rest', () => {
    const summary = renderUnpublishedSummary(
      syncReport({
        unpublished: Array.from({ length: 205 }, (_, index) => ({
          ...entry,
          id: `file-${index}`,
        })),
      }),
      pageUrl,
    );

    expect(
      summary.split('\n').filter((line) => line.startsWith('| Not on')),
    ).toHaveLength(200);
    expect(summary).toContain('5 more are listed on the content health page.');
  });
});

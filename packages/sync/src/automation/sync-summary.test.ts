import { describe, expect, it } from 'vitest';

import { readSourceTitle } from '../titles/source-title.js';
import { createTitleReport } from '../titles/title-report.js';
import {
  renderContentHealthSummary,
  renderSyncJobSummary,
} from './sync-summary.js';

describe('renderSyncJobSummary', () => {
  it('renders aggregate counts without document content', () => {
    const summary = renderSyncJobSummary(
      {
        schemaVersion: 1,
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
        },
      },
      true,
    );

    expect(summary).toContain('Generated output changed: yes');
    expect(summary).toContain('| Added | 2 |');
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

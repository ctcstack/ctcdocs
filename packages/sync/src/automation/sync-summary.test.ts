import { describe, expect, it } from 'vitest';

import { renderSyncJobSummary } from './sync-summary.js';

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

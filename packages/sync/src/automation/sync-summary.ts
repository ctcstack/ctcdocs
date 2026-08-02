import type { SyncReport } from '../generation/sync-report.js';

export function renderSyncJobSummary(
  report: SyncReport,
  outputChanged: boolean,
): string {
  const rows = [
    ['Added', report.summary.added],
    ['Changed', report.summary.changed],
    ['Unchanged', report.summary.unchanged],
    ['Removed', report.summary.removed],
    ['Folders', report.summary.folders],
    ['Unsupported', report.summary.unsupported],
    ['Warnings', report.summary.warnings],
  ] as const;

  return [
    '## Knowledge Base sync',
    '',
    `- Mode: ${report.dryRun ? 'dry run' : 'write'}`,
    `- Generated output changed: ${outputChanged ? 'yes' : 'no'}`,
    `- Manifest timestamp: \`${report.generatedAt}\``,
    '',
    '| Result | Count |',
    '| --- | ---: |',
    ...rows.map(([label, count]) => `| ${label} | ${count} |`),
    '',
  ].join('\n');
}

import type { SyncReport } from '../generation/sync-report.js';
import { SEVERITY_LABELS } from '../titles/checks.js';
import type { TitleReport } from '../titles/title-report.js';

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

/**
 * What editors have left to fix, as counts and a link to the page that names
 * the documents (ADR-024). Titles and headings stay out of the job summary.
 */
export function renderContentHealthSummary(
  report: TitleReport,
  pageUrl: string,
): string {
  const { summary } = report;
  const rows = (['fix', 'convention', 'note'] as const).flatMap((severity) =>
    report.checks
      .filter((check) => check.severity === severity)
      .map(
        (check) =>
          `| ${SEVERITY_LABELS[severity]} | ${check.title} | ${summary.checks[check.code]} |`,
      ),
  );
  return [
    '## Content health',
    '',
    `- Following the proposed convention: ${summary.conforming} of ${summary.inspected} inspected documents`,
    ...(summary.inspected < summary.documents
      ? [
          `- Not inspected yet: ${summary.documents - summary.inspected} (run a full sync to inspect them)`,
        ]
      : []),
    `- Documents, links and instructions: [content health page](${pageUrl})`,
    '',
    '| Group | Check | Documents |',
    '| --- | --- | ---: |',
    ...rows,
    '',
  ].join('\n');
}

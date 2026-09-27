import type { SyncReport } from '../generation/sync-report.js';
import { UNPUBLISHED_STATUS_LABELS } from '../generation/unpublished.js';
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
    ['Not on the site', report.summary.notPublished],
    ['Out of date on the site', report.summary.outOfDate],
    ['Ignored by configuration', report.summary.ignored],
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

/** The most files the job summary lists; the page lists every one. */
const MAX_LISTED_FILES = 200;

/**
 * A Drive name or folder label as literal text in a table cell. Every ASCII
 * punctuation mark is escaped, so a name reads as typed and never becomes a
 * link, markup or a new column.
 */
function cell(value: string): string {
  return value
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/[!-/:-@[-`{-~]/gu, '\\$&')
    .trim();
}

/**
 * Every file in the published folders that is not on the site as it is in
 * Drive, with the reason, and the folders the configuration keeps off it
 * (ADR-025). Unlike the content health counts, this names files: a file that
 * never reached the site cannot be found there, and the job summary is where
 * an operator looks after a sync.
 */
export function renderUnpublishedSummary(
  report: SyncReport,
  pageUrl: string,
): string {
  const reasonTitles = new Map(
    report.reasons.map((reason) => [reason.code, reason.title]),
  );
  const listed = report.unpublished.slice(0, MAX_LISTED_FILES);
  const lines = [
    '## Not on the site',
    '',
    report.unpublished.length === 0
      ? '- Every file in the published folders is on the site.'
      : `- Files not on the site: ${report.summary.notPublished}; documents out of date on the site: ${report.summary.outOfDate}`,
    `- What to do about each: [content health page](${pageUrl}#not-on-the-site)`,
    '',
  ];
  if (listed.length > 0) {
    lines.push(
      '| Status | Reason | Folder | Name | Type |',
      '| --- | --- | --- | --- | --- |',
      ...listed.map((item) =>
        [
          '',
          UNPUBLISHED_STATUS_LABELS[item.status],
          cell(reasonTitles.get(item.reason) ?? item.reason) +
            (item.detail ? ` (${cell(item.detail)})` : ''),
          item.folderPath.length > 0
            ? item.folderPath.map(cell).join(' › ')
            : 'General',
          cell(item.name),
          cell(item.type),
          '',
        ]
          .join(' | ')
          .trim(),
      ),
      '',
    );
    if (report.unpublished.length > listed.length) {
      lines.push(
        `${report.unpublished.length - listed.length} more are listed on the content health page.`,
        '',
      );
    }
  }
  if (report.ignoredFolders.length > 0) {
    lines.push(
      '### Ignored by configuration',
      '',
      '| Folder | Items below it |',
      '| --- | ---: |',
      ...report.ignoredFolders.map(
        (folder) =>
          `| ${[...folder.folderPath, folder.name].map(cell).join(' › ')} | ${folder.items} |`,
      ),
      '',
    );
  }
  return lines.join('\n');
}

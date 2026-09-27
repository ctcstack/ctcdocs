import { SEVERITY_LABELS } from './checks.js';
import type { TitleReport } from './title-report.js';

function counts(values: Readonly<Record<string, number>>): string {
  return Object.entries(values)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => `${key} ${count}`)
    .join(', ');
}

function googleDocsUrl(
  id: string,
  issue?: { headingId?: string; tabId?: string },
): string {
  const tab = issue?.tabId ? `?tab=${issue.tabId}` : '';
  const heading = issue?.headingId ? `#heading=${issue.headingId}` : '';
  return `https://docs.google.com/document/d/${id}/edit${tab}${heading}`;
}

/**
 * The report as a terminal reads it. The summary carries only counts; the
 * listing names documents and quotes their headings, so it is for a person at
 * a terminal, not for a CI log. The content health page shows the same, with
 * filters (ADR-024).
 */
export function formatTitleReport(
  report: TitleReport,
  options: { list: boolean; path: string },
): string[] {
  const { summary } = report;
  const lines = [
    `Title report: ${summary.documents} documents, ${summary.inspected} inspected (${options.path})`,
    `Following the proposed convention: ${summary.conforming} of ${summary.inspected}`,
  ];
  for (const severity of ['fix', 'convention', 'note'] as const) {
    const checks = report.checks.filter((check) => check.severity === severity);
    lines.push('', `${SEVERITY_LABELS[severity]}`);
    for (const check of checks) {
      lines.push(
        `  ${String(summary.checks[check.code]).padStart(4)}  ${check.title}`,
      );
    }
  }
  lines.push(
    '',
    `First block:       ${counts(summary.firstBlock)}`,
    `Title candidate:   ${counts(summary.candidate)} (opens the document: ${summary.candidateOpensDocument})`,
    `Against file name: ${counts(summary.match)}`,
  );
  if (summary.inspected < summary.documents) {
    lines.push(
      '',
      `${summary.documents - summary.inspected} documents have not been inspected yet; a full sync inspects every document.`,
    );
  }
  if (!options.list) {
    lines.push('', 'Run with --list to see the documents behind each count.');
    return lines;
  }

  for (const check of report.checks) {
    const documents = report.documents.filter((document) =>
      document.issues.some((issue) => issue.check === check.code),
    );
    if (documents.length === 0) {
      continue;
    }
    lines.push(
      '',
      `${check.title} (${documents.length})`,
      `  ${check.instruction}`,
    );
    for (const document of documents) {
      const issues = document.issues.filter(
        (issue) => issue.check === check.code,
      );
      lines.push(
        `  - ${document.name}${document.lastEditedBy ? ` (last edited by ${document.lastEditedBy})` : ''}`,
      );
      for (const issue of issues) {
        const quoted = issue.text
          ? `“${issue.text}”${issue.detail ? ` — ${issue.detail}` : ''}${issue.related ? ` — the title of “${issue.related.title}”` : ''}`
          : undefined;
        if (quoted) {
          lines.push(`      ${quoted}`);
        }
      }
      lines.push(
        `      ${googleDocsUrl(
          document.id,
          issues.find((issue) => issue.headingId),
        )}`,
      );
    }
  }
  return lines;
}

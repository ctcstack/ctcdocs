import type { TitleMatch, TitleReport } from './title-report.js';

/** Categories worth reading one by one: the ones that are not already a match. */
const LISTED_MATCHES: readonly TitleMatch[] = [
  'contains',
  'contained',
  'similar',
  'different',
];

function counts(values: Readonly<Record<string, number>>): string {
  return Object.entries(values)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => `${key} ${count}`)
    .join(', ');
}

/**
 * The report as a terminal reads it. The summary carries only counts; the
 * listing names documents and quotes their headings, so it is for a person at
 * a terminal, not for a CI log.
 */
export function formatTitleReport(
  report: TitleReport,
  options: { list: boolean; path: string },
): string[] {
  const { summary } = report;
  const lines = [
    `Title report: ${summary.documents} documents, ${summary.inspected} inspected (${options.path})`,
    '',
    `First block:       ${counts(summary.firstBlock)}`,
    `Title candidate:   ${counts(summary.candidate)} (opens the document: ${summary.candidateOpensDocument})`,
    `Against file name: ${counts(summary.match)}`,
    `Heading 1 dropped as a copy of the file name: ${summary.removedTitleHeading}`,
    `Several Title paragraphs: ${summary.severalTitles}; several Heading 1: ${summary.severalHeading1}`,
    `File names:        ${counts(summary.names) || 'nothing notable'}`,
    `Documents with a heading mixing alphabets: ${summary.mixedScriptHeadings}`,
  ];
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

  for (const match of LISTED_MATCHES) {
    const documents = report.documents.filter(
      (document) => document.match === match,
    );
    if (documents.length === 0) {
      continue;
    }
    lines.push('', `${match} (${documents.length})`);
    for (const document of [...documents].sort(
      (left, right) => (left.similarity ?? 0) - (right.similarity ?? 0),
    )) {
      const candidate = document.source?.candidate;
      lines.push(
        `  ${(document.similarity ?? 0).toFixed(2)}  ${document.name}`,
        `        ${candidate?.style ?? ''}: ${candidate?.text ?? ''}`,
      );
    }
  }
  const mixed = report.documents.filter(
    (document) => document.mixedScriptHeadings.length > 0,
  );
  if (mixed.length > 0) {
    lines.push('', `Headings mixing alphabets (${mixed.length} documents)`);
    for (const document of mixed) {
      lines.push(`  /${document.slug}/`);
      for (const heading of document.mixedScriptHeadings) {
        lines.push(`        ${heading.text} — ${heading.detail}`);
      }
    }
  }
  return lines;
}

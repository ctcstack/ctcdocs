/**
 * The job summary of a sync run: what the run did, what the site holds and
 * lacks, what to know about it, and, when the run fails, why (ADR-028).
 *
 * It is written in three places so that each part says what it knows:
 *
 * - the sync step writes what this run changed, which only it knows;
 * - the summary step writes the state of the site from the committed report;
 * - a failed sync step writes what stopped it and what to do.
 *
 * Every Drive name, folder and editor is escaped so that it reads as typed
 * and never becomes markup, a link or a new column. The catalog's own wording
 * is the platform's, and goes in as written.
 */
import type { SyncReport } from '../generation/sync-report.js';
import { UNPUBLISHED_STATUS_LABELS } from '../generation/unpublished.js';
import type { RunChanges } from '../run-sync.js';
import { SEVERITY_LABELS } from '../titles/checks.js';
import type { TitleReport } from '../titles/title-report.js';

/** The most rows one group lists; the content health page lists every one. */
const MAX_ROWS_PER_GROUP = 100;

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

function row(cells: readonly string[]): string {
  return `| ${cells.join(' | ')} |`;
}

function trail(folderPath: readonly string[]): string {
  return folderPath.length > 0 ? folderPath.map(cell).join(' › ') : 'General';
}

function pageUrl(siteUrl: string, slug: string): string {
  return `${siteUrl}/${slug.split('/').map(encodeURIComponent).join('/')}/`;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** A collapsible block, which GitHub renders in a job summary. */
function details(summary: string, body: readonly string[]): string[] {
  return [
    '<details>',
    `<summary>${summary}</summary>`,
    '',
    ...body,
    '',
    '</details>',
    '',
  ];
}

/** Where a group's items are, by top-level section: `Teams (4), General (1)`. */
function where(items: ReadonlyArray<{ folderPath: readonly string[] }>) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const section = item.folderPath[0] ?? 'General';
    counts.set(section, (counts.get(section) ?? 0) + 1);
  }
  const sections = [...counts]
    .sort(
      ([leftName, left], [rightName, right]) =>
        right - left || (leftName < rightName ? -1 : 1),
    )
    .map(([name, count]) => `${cell(name)} (${count})`);
  return sections.length > 3
    ? `${sections.slice(0, 3).join(', ')} and ${plural(sections.length - 3, 'more section')}`
    : sections.join(', ');
}

/** What one sync run changed on the site, with a link to each page. */
export function renderRunSummary(
  run: {
    changes: RunChanges;
    exported: number;
    dryRun: boolean;
    full: boolean;
    outputChanged: boolean;
  },
  siteUrl: string,
): string {
  const { added, changed, removed, moved } = run.changes;
  const nothing =
    added.length + changed.length + removed.length + moved.length === 0;
  const verb = run.dryRun ? 'would' : 'did';
  const lines = [
    `## Sync run${run.dryRun ? ' (dry run)' : ''}`,
    '',
    nothing
      ? `**Nothing on the site changed.** The run ${verb} not add, change or remove a page.`
      : `**${plural(added.length, 'page')} added, ${changed.length} changed, ${removed.length} removed, ${plural(moved.length, 'address', 'addresses')} moved.**`,
    '',
    `- ${run.full ? 'Full sync' : 'Sync'}: ${plural(run.exported, 'document')} exported from Google.`,
    `- Generated output ${run.dryRun ? 'would change' : 'changed'}: ${run.outputChanged ? 'yes' : 'no'}`,
    '',
  ];
  const listPages = (
    heading: string,
    pages: RunChanges['added'],
    linked: boolean,
  ) =>
    pages.length === 0
      ? []
      : details(
          `<b>${heading}</b> — ${pages.length}`,
          pages
            .slice(0, MAX_ROWS_PER_GROUP)
            .map(
              (page) =>
                `- ${linked ? `[${cell(page.title)}](${pageUrl(siteUrl, page.slug)})` : cell(page.title)}${page.format === 'pdf' ? ' · PDF' : ''}`,
            )
            .concat(
              pages.length > MAX_ROWS_PER_GROUP
                ? [`- and ${pages.length - MAX_ROWS_PER_GROUP} more`]
                : [],
            ),
        );
  lines.push(
    ...listPages('Added', added, true),
    ...listPages('Changed', changed, true),
    ...listPages('Removed', removed, false),
  );
  if (moved.length > 0) {
    lines.push(
      ...details(`<b>Addresses moved</b> — ${moved.length}`, [
        '| Page | From | To |',
        '| --- | --- | --- |',
        ...moved
          .slice(0, MAX_ROWS_PER_GROUP)
          .map((move) =>
            row([
              cell(move.title),
              `/${cell(move.from)}/`,
              `/${cell(move.to)}/`,
            ]),
          ),
      ]),
    );
  }
  return lines.join('\n');
}

/**
 * The state of the site after the run, from the report it committed: what is
 * on it, what is not and why, and what to know, grouped by what to do (ADR-025,
 * ADR-028).
 */
export function renderSiteSummary(
  report: SyncReport,
  contentHealthUrl: string,
): string {
  const { summary } = report;
  const lines = [
    '## Knowledge Base',
    '',
    `**On the site: ${plural(summary.published.googleDocs + summary.published.pdfs, 'page')}** — ${plural(summary.published.googleDocs, 'Google Doc')}, ${plural(summary.published.pdfs, 'PDF')}. ` +
      `**Not on the site: ${summary.notPublished}** · out of date: ${summary.outOfDate} · incomplete: ${summary.incomplete} · notes: ${summary.notes}.`,
    '',
    `The same lists, with filters by section and editor: [content health page](${contentHealthUrl}).`,
    '',
  ];

  const groups = report.reasons
    .map((reason) => ({
      reason,
      items: report.unpublished.filter((item) => item.reason === reason.code),
    }))
    .filter((group) => group.items.length > 0);
  lines.push(
    `### Not on the site as it is in Drive — ${report.unpublished.length}`,
    '',
  );
  if (groups.length === 0) {
    lines.push('Every file in the published folders is on the site.', '');
  } else {
    lines.push(
      '| What | Files | Where | What to do |',
      '| --- | ---: | --- | --- |',
      ...groups.map(({ reason, items }) =>
        row([reason.title, String(items.length), where(items), reason.action]),
      ),
      '',
    );
    for (const { reason, items } of groups) {
      lines.push(
        ...details(`<b>${reason.title}</b> — ${items.length}`, [
          reason.instruction,
          '',
          '| Folder | Name | Type | Status | Last edited by |',
          '| --- | --- | --- | --- | --- |',
          ...items
            .slice(0, MAX_ROWS_PER_GROUP)
            .map((item) =>
              row([
                trail(item.folderPath),
                `[${cell(item.name)}](${item.sourceUrl})${item.detail ? ` — ${cell(item.detail)}` : ''}`,
                cell(item.type),
                UNPUBLISHED_STATUS_LABELS[item.status],
                cell(item.lastEditedBy ?? '—'),
              ]),
            ),
          ...(items.length > MAX_ROWS_PER_GROUP
            ? ['', `${items.length - MAX_ROWS_PER_GROUP} more on the page.`]
            : []),
        ]),
      );
    }
  }

  const noteGroups = report.noteKinds
    .map((kind) => ({
      kind,
      items: report.notes.filter((note) => note.note === kind.code),
    }))
    .filter((group) => group.items.length > 0);
  lines.push(`### Notes — ${report.notes.length}`, '');
  if (noteGroups.length === 0) {
    lines.push(
      'Nothing to note: every published page came through conversion whole.',
      '',
    );
  } else {
    lines.push(
      '| What | Items | Where | What to do |',
      '| --- | ---: | --- | --- |',
      ...noteGroups.map(({ kind, items }) =>
        row([kind.title, String(items.length), where(items), kind.action]),
      ),
      '',
    );
    for (const { kind, items } of noteGroups) {
      lines.push(
        ...details(`<b>${kind.title}</b> — ${items.length}`, [
          kind.instruction,
          '',
          '| Folder | Name | Detail |',
          '| --- | --- | --- |',
          ...items
            .slice(0, MAX_ROWS_PER_GROUP)
            .map((note) =>
              row([
                trail(note.folderPath),
                `[${cell(note.name)}](${note.sourceUrl})`,
                cell(note.detail ?? ''),
              ]),
            ),
        ]),
      );
    }
  }

  if (report.ignoredFolders.length > 0) {
    lines.push(
      `### Ignored by configuration — ${report.ignoredFolders.length}`,
      '',
      '| Folder | Items below it |',
      '| --- | ---: |',
      ...report.ignoredFolders.map((folder) =>
        row([
          [...folder.folderPath, folder.name].map(cell).join(' › '),
          String(folder.items),
        ]),
      ),
      '',
    );
  }

  lines.push(
    '### How the pages were made',
    '',
    `${plural(summary.conversion.markdown, 'Google Doc')} from Google's Markdown export, ${summary.conversion.html} through its HTML export for images, tables or drawings, ${plural(summary.published.pdfs, 'PDF')} published as files with their text.`,
    '',
  );
  return lines.join('\n');
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

/** What a failure means and what to do about it, by its log category. */
const FAILURES: Readonly<Record<string, { meaning: string; action: string }>> =
  {
    AUTHENTICATION: {
      meaning: 'The sync has no Google credentials to use.',
      action:
        'Check the Google WIF setup of the sync workflow and its environment.',
    },
    GOOGLE_AUTHENTICATION: {
      meaning: 'Google did not accept the sync identity.',
      action:
        'Check the Workload Identity Federation provider and the service account it impersonates.',
    },
    GOOGLE_PERMISSION: {
      meaning:
        'The sync identity cannot read the Shared Drive or a file in it, or an API is not enabled.',
      action:
        'Check that the identity is still a Viewer of the Shared Drive and that the Drive and Docs APIs are enabled.',
    },
    GOOGLE_DOWNLOAD_RESTRICTED: {
      meaning:
        'A document the run was asked for stops viewers from downloading it.',
      action: 'Lift that restriction in the document, then run again.',
    },
    GOOGLE_EXPORT_SIZE_LIMIT: {
      meaning:
        'A document the run was asked for is over the 10 MB Google exports.',
      action: 'Shrink its images or split it, then run again.',
    },
    GOOGLE_RATE_LIMIT: {
      meaning: 'Google asked the sync to slow down, and retrying did not help.',
      action: 'Run again later.',
    },
    GOOGLE_SERVER: {
      meaning: 'Google answered with a server error.',
      action: 'Run again later.',
    },
    GOOGLE_NETWORK: {
      meaning: 'The runner could not reach Google.',
      action: 'Run again.',
    },
    GOOGLE_INVALID_RESPONSE: {
      meaning: 'Google answered with something the sync cannot read.',
      action: 'Run again; if it repeats, report it to the platform.',
    },
    INVENTORY_GRAPH: {
      meaning:
        'The Drive tree has a problem the site cannot publish around, such as a folder named with a letter from another alphabet.',
      action:
        'Open each item below by its ID in Drive, fix what its code names, and run again.',
    },
    MARKDOWN_NORMALIZATION: {
      meaning: 'A document the run was asked for holds content it refuses.',
      action: 'Fix the document, then run again.',
    },
    CONTENT_CONVERSION: {
      meaning: 'A document the run was asked for could not be converted.',
      action: 'Fix the document, then run again.',
    },
    GENERATED_OUTPUT_VALIDATION: {
      meaning: 'The pages the run built failed their own checks.',
      action: 'Report it to the platform with this run.',
    },
    SYNC_SELECTION: {
      meaning: 'The run was asked for something the corpus does not allow.',
      action: 'Read the message and run again as it says.',
    },
    MANIFEST: {
      meaning: 'The record of what the site publishes could not be read.',
      action: 'Report it to the platform with this run.',
    },
    CONFIGURATION: {
      meaning: 'The sync configuration is incomplete or invalid.',
      action: 'Check the variables the message names.',
    },
  };

/** Why a sync run stopped, what that means and what to do (ADR-028). */
export function renderFailureSummary(label: string, lines: readonly string[]) {
  const failure = FAILURES[label] ?? {
    meaning: 'The sync stopped on something it does not expect.',
    action: 'Read the log of this step, and report it to the platform.',
  };
  return [
    '## Sync failed',
    '',
    '**Nothing was published.** The site still shows the last good sync.',
    '',
    `- What happened: ${failure.meaning}`,
    `- What to do: ${failure.action}`,
    '',
    '```text',
    ...lines.map((line) => line.replace(/```/gu, "'''")),
    '```',
    '',
  ].join('\n');
}

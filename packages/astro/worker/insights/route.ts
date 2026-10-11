/**
 * The latest weekly report for an admin (ADR-051), at `/_kb/insights.json`.
 *
 * The gate decides who asks before this answers: the admins class, read as
 * the access review page is, so no one else, and no one while the snapshot
 * is stale. This reads the database and answers with the report and the
 * title and permanent link of each document it names, from the build the
 * Worker serves; a document the build does not list is named by its ID
 * alone. It is never cached.
 */
import { PERMANENT_LINK_PREFIX, type AccessMapFile } from '../access-map.js';
import type { StateDatabase } from '../state/database.js';
import { failureMessage, type StateLog } from '../state/record.js';
import type { WeeklyReport } from './report.js';
import { latestReport } from './weekly.js';

interface InsightsAnswer {
  readonly report: WeeklyReport | null;
  /** Each document the report names, that the build lists. */
  readonly documents: Readonly<
    Record<string, { readonly title: string; readonly url: string }>
  >;
}

/** The short IDs a report names, in every list that names one. */
function namedDocuments(report: WeeklyReport): Set<string> {
  return new Set([
    ...[...report.notFound, ...report.askedMost].flatMap((group) =>
      group.documents.map((entry) => entry.id),
    ),
    ...report.foundNotRead.map((entry) => entry.id),
  ]);
}

export async function insightsAnswer({
  map,
  database,
  log,
}: {
  readonly map: AccessMapFile;
  readonly database: StateDatabase | undefined;
  readonly log: StateLog;
}): Promise<Response> {
  if (!map.site.insights.enabled) {
    return new Response('Insights are not on for this site.', { status: 404 });
  }
  if (!database) {
    return new Response('The insights database is not bound.', {
      status: 503,
    });
  }
  let report: WeeklyReport | undefined;
  try {
    report = await latestReport(database);
  } catch (error: unknown) {
    log({ event: 'insights-read-failed', error: failureMessage(error) });
    return new Response('The insights report could not be read.', {
      status: 503,
    });
  }
  const catalog = new Map(
    (map.agents?.documents ?? []).map((document) => [document.id, document]),
  );
  const documents = Object.fromEntries(
    [...(report ? namedDocuments(report) : [])].sort().flatMap((id) => {
      const document = catalog.get(id);
      return document
        ? [
            [
              id,
              {
                title: document.title,
                url: `${PERMANENT_LINK_PREFIX}${id}/`,
              },
            ],
          ]
        : [];
    }),
  );
  return Response.json({
    report: report ?? null,
    documents,
  } satisfies InsightsAnswer);
}

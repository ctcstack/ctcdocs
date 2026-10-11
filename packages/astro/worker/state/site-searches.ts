/**
 * One record per settled search on the site (ADR-051), sent by the page and
 * written after the Worker's answer.
 *
 * Like a record of an MCP call, it names the access classes the reader may
 * read, from the session, never the reader, and its query is cut to 200
 * characters. `opened` is the page the reader opened from the results: a
 * page of this build the reader may read, or nothing.
 */
import type { StateDatabase } from './database.js';
import { backgroundWriter, recordedQuery, type StateLog } from './record.js';

export interface SiteSearch {
  readonly at: string;
  readonly query: string;
  readonly classes: readonly string[];
  /** Results the search showed. */
  readonly results: number;
  readonly opened: string | null;
}

async function insertSiteSearch(
  database: StateDatabase,
  search: SiteSearch,
): Promise<void> {
  await database
    .prepare(
      `INSERT INTO site_searches (at, query, classes, results, opened)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      search.at,
      recordedQuery(search.query),
      JSON.stringify([...search.classes].sort()),
      search.results,
      search.opened,
    )
    .run();
}

/** Records site searches in `database`, in the background. */
export function siteSearchRecorder({
  database,
  schedule,
  log,
}: {
  readonly database: StateDatabase;
  readonly schedule: (write: Promise<void>) => void;
  readonly log: StateLog;
}): (search: SiteSearch) => void {
  return backgroundWriter({
    table: 'site_searches',
    write: (search: SiteSearch) => insertSiteSearch(database, search),
    schedule,
    log,
  });
}

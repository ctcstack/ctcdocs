/**
 * Making and keeping the weekly report (ADR-051).
 *
 * On each run of the Worker's schedule, the week before this one is
 * reported, once: a run that finds its report kept does nothing, so a run
 * that failed is made up by the next. A week with no record is not
 * reported. The rows are read through the database interface and parsed
 * here, at the boundary, so the report itself is a function of plain
 * values.
 */
import { z } from 'zod';

import type { StateDatabase } from '../state/database.js';
import { failureMessage, type StateLog } from '../state/record.js';
import {
  weeklyReport,
  type CallRow,
  type ReportSettings,
  type ReportWeek,
  type SiteSearchRow,
  type WeeklyReport,
} from './report.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Rows of each table a report reads at most; past it, it says so. */
const REPORT_ROWS = 50_000;

/** The week before the one `now` falls in, Monday to Monday, in UTC. */
export function lastWeek(now: number): ReportWeek {
  const today = new Date(now);
  const sinceMonday = (today.getUTCDay() + 6) % 7;
  const thisMonday = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate() - sinceMonday,
  );
  return weekFrom(thisMonday - 7 * DAY_MS);
}

/** The week that begins on `monday`, a `YYYY-MM-DD` date or its time. */
export function weekFrom(monday: number | string): ReportWeek {
  const start =
    typeof monday === 'number' ? monday : Date.parse(`${monday}T00:00:00Z`);
  const from = new Date(start);
  // A date that does not exist, as 30 February, is not read as another.
  if (
    Number.isNaN(start) ||
    from.getUTCDay() !== 1 ||
    (typeof monday === 'string' && from.toISOString().slice(0, 10) !== monday)
  ) {
    throw new RangeError('A week begins on a Monday, given as YYYY-MM-DD.');
  }
  return {
    week: from.toISOString().slice(0, 10),
    from: from.toISOString(),
    to: new Date(start + 7 * DAY_MS).toISOString(),
  };
}

/** A JSON array of strings, as the records keep classes and documents. */
const stringList = z
  .string()
  .transform((text, context) => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      context.addIssue({ code: 'custom', message: 'not JSON' });
      return z.NEVER;
    }
  })
  .pipe(z.array(z.string()));

const flag = z.union([z.literal(0), z.literal(1)]).transform((on) => on === 1);

const callRow = z
  .object({
    id: z.number().int(),
    tool: z.enum(['search', 'fetch', 'browse', 'recent']),
    query: z.string().nullable(),
    narrowed: flag,
    classes: stringList,
    client: z.string().nullable(),
    results: z.number().int(),
    top_score: z.number().nullable(),
    documents: stringList,
    fetched: z.string().nullable(),
    characters: z.number().int(),
    latency_ms: z.number().int(),
  })
  .transform(({ top_score, latency_ms, ...row }): CallRow => ({
    ...row,
    topScore: top_score,
    latencyMs: latency_ms,
  }));

const siteSearchRow = z.object({
  id: z.number().int(),
  query: z.string(),
  classes: stringList,
  results: z.number().int(),
});

/**
 * The rows that parse. A row the schema allowed but this cannot read is left
 * out, and counted, so that a drift between the two shows in the report.
 */
function parsed<T>(
  rows: readonly unknown[],
  schema: z.ZodType<T>,
): { rows: T[]; unreadable: number } {
  const read = rows.flatMap((row) => {
    const result = schema.safeParse(row);
    return result.success ? [result.data] : [];
  });
  return { rows: read, unreadable: rows.length - read.length };
}

/** A week's records, at most `limit` of each table. */
export async function readWeek(
  database: StateDatabase,
  { from, to }: ReportWeek,
  limit = REPORT_ROWS,
): Promise<{
  calls: CallRow[];
  siteSearches: SiteSearchRow[];
  truncated: boolean;
  unreadable: number;
}> {
  const [calls, searches] = await Promise.all([
    database
      .prepare(
        `SELECT id, tool, query, narrowed, classes, client, results,
                top_score, documents, fetched, characters, latency_ms
           FROM mcp_calls WHERE at >= ? AND at < ? ORDER BY id LIMIT ?`,
      )
      .bind(from, to, limit + 1)
      .all(),
    database
      .prepare(
        `SELECT id, query, classes, results
           FROM site_searches WHERE at >= ? AND at < ? ORDER BY id LIMIT ?`,
      )
      .bind(from, to, limit + 1)
      .all(),
  ]);
  const read = parsed(calls.results.slice(0, limit), callRow);
  const searched = parsed(searches.results.slice(0, limit), siteSearchRow);
  return {
    calls: read.rows,
    siteSearches: searched.rows,
    truncated: calls.results.length > limit || searches.results.length > limit,
    unreadable: read.unreadable + searched.unreadable,
  };
}

/** The week's report from its records; none for a week with no record. */
export async function makeReport({
  database,
  week,
  now,
  settings,
}: {
  readonly database: StateDatabase;
  readonly week: ReportWeek;
  readonly now: number;
  readonly settings: ReportSettings;
}): Promise<WeeklyReport | undefined> {
  const { calls, siteSearches, truncated, unreadable } = await readWeek(
    database,
    week,
  );
  if (calls.length === 0 && siteSearches.length === 0 && unreadable === 0) {
    return undefined;
  }
  return weeklyReport({
    week,
    made: new Date(now).toISOString(),
    calls,
    siteSearches,
    truncated,
    unreadable,
    settings,
  });
}

/** The latest kept report, if there is one. */
export async function latestReport(
  database: StateDatabase,
): Promise<WeeklyReport | undefined> {
  const { results } = await database
    .prepare('SELECT report FROM reports ORDER BY week DESC LIMIT 1')
    .all();
  return reportOf(results[0]);
}

function reportOf(row: unknown): WeeklyReport | undefined {
  const report = (row as { report?: unknown } | undefined)?.report;
  return typeof report === 'string'
    ? (JSON.parse(report) as WeeklyReport)
    : undefined;
}

/** The kept report of a week, if there is one, as JSON text parsed. */
export async function keptReport(
  database: StateDatabase,
  week: string,
): Promise<WeeklyReport | undefined> {
  const { results } = await database
    .prepare('SELECT report FROM reports WHERE week = ?')
    .bind(week)
    .all();
  return reportOf(results[0]);
}

/**
 * Reports last week, unless it is kept or held no record, and logs what it
 * made: counts, never a query. It never throws.
 */
export async function reportLastWeek({
  database,
  now,
  settings,
  log,
}: {
  readonly database: StateDatabase;
  readonly now: number;
  readonly settings: ReportSettings;
  readonly log: StateLog;
}): Promise<void> {
  try {
    const week = lastWeek(now);
    const { results } = await database
      .prepare('SELECT week FROM reports WHERE week = ?')
      .bind(week.week)
      .all();
    if (results.length > 0) {
      return;
    }
    const report = await makeReport({ database, week, now, settings });
    if (!report) {
      return;
    }
    // Two runs at once keep the first report; the second changes nothing.
    const { meta } = await database
      .prepare(
        'INSERT INTO reports (week, at, report) VALUES (?, ?, ?) ON CONFLICT (week) DO NOTHING',
      )
      .bind(report.week, report.made, JSON.stringify(report))
      .run();
    if (meta.changes === 0) {
      return;
    }
    log({
      event: 'insights-reported',
      week: report.week,
      mcpCalls: report.records.mcpCalls,
      siteSearches: report.records.siteSearches,
      truncated: report.records.truncated,
      unreadable: report.records.unreadable,
      notFound: report.notFound.length,
    });
  } catch (error: unknown) {
    log({ event: 'insights-report-failed', error: failureMessage(error) });
  }
}

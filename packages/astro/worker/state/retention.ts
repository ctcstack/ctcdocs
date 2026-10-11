/**
 * How long each kind of record is kept (ADR-050), and the deletion the
 * Worker's schedule runs.
 *
 * Every record of use follows `insights.retentionDays` (ADR-051). A weekly
 * report quotes queries, so it goes when the oldest record it was made from
 * goes: its `week` is that week's Monday, which sorts before any time on that
 * day. D1's Time Travel keeps deleted rows 30 days more.
 */
import type { StateDatabase } from './database.js';
import { failureMessage, type StateLog } from './record.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Each table of records, and the column whose text orders it in time. */
const RECORDS = [
  { table: 'mcp_calls', time: 'at' },
  { table: 'site_searches', time: 'at' },
  { table: 'reports', time: 'week' },
] as const;

/**
 * Deletes every record older than the retention, in one transaction, and
 * logs what it deleted. It never throws: a failure is logged, and the next
 * run deletes what this one did not.
 */
export async function expireRecords({
  database,
  retentionDays,
  now,
  log,
}: {
  readonly database: StateDatabase;
  readonly retentionDays: number;
  readonly now: number;
  readonly log: StateLog;
}): Promise<void> {
  try {
    const before = new Date(now - retentionDays * DAY_MS).toISOString();
    const results = await database.batch(
      RECORDS.map(({ table, time }) =>
        database.prepare(`DELETE FROM ${table} WHERE ${time} < ?`).bind(before),
      ),
    );
    log({
      event: 'state-expired',
      retentionDays,
      deleted: Object.fromEntries(
        RECORDS.map(({ table }, index) => [
          table,
          results[index]?.meta.changes ?? 0,
        ]),
      ),
    });
  } catch (error: unknown) {
    log({ event: 'state-expiry-failed', error: failureMessage(error) });
  }
}

/**
 * What the Worker's schedule asks of the database. Retention follows the
 * database, not the recording: whenever one is bound, what is past its line
 * is deleted, so turning insights off stops new records and still lets the
 * old ones go. Recording with no database bound is logged, since nothing is
 * kept.
 */
export function expireOnSchedule({
  insights,
  database,
  now,
  log,
}: {
  readonly insights: {
    readonly enabled: boolean;
    readonly retentionDays: number;
  };
  readonly database: StateDatabase | undefined;
  readonly now: number;
  readonly log: StateLog;
}): Promise<void> | undefined {
  if (!database) {
    if (insights.enabled) {
      log({ event: 'state-unbound' });
    }
    return undefined;
  }
  return expireRecords({
    database,
    retentionDays: insights.retentionDays,
    now,
    log,
  });
}

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

const DAY_MS = 24 * 60 * 60 * 1000;

/** Each table of records, and the column whose text orders it in time. */
const RECORDS = [
  { table: 'mcp_calls', time: 'at' },
  { table: 'site_searches', time: 'at' },
  { table: 'reports', time: 'week' },
] as const;

/** At most this much of a failure's message is logged. */
const MESSAGE_CHARACTERS = 200;

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
  readonly log: (event: Readonly<Record<string, unknown>>) => void;
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
    /*
     * D1 names the table or the constraint that failed, never a bound
     * value: a missing migration shows up here as "no such table".
     */
    log({
      event: 'state-expiry-failed',
      error:
        error instanceof Error
          ? error.message.slice(0, MESSAGE_CHARACTERS)
          : 'unknown',
    });
  }
}

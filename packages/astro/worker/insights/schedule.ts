/**
 * What the Worker's schedule asks of the database (ADR-050, ADR-051): the
 * deletion of what is past its retention, then last week's report.
 *
 * Deletion comes first, so that a report that cannot finish, in a week too
 * heavy for one run, never keeps a record past its line. It never takes
 * what the report reads: retention is at least two weeks, and the report's
 * week ended under one ago. Retention follows the database, not the
 * recording:
 * whenever one is bound, what is past its line is deleted, so turning
 * insights off stops new records and reports and still lets the old ones
 * go. Recording with no database bound is logged, since nothing is kept.
 */
import type { AccessMapFile } from '../access-map.js';
import type { StateDatabase } from '../state/database.js';
import type { StateLog } from '../state/record.js';
import { expireRecords } from '../state/retention.js';
import { reportLastWeek } from './weekly.js';
import { stopWordsFor } from './words.js';

export async function maintainState({
  insights,
  database,
  now,
  log,
}: {
  readonly insights: AccessMapFile['site']['insights'];
  readonly database: StateDatabase | undefined;
  readonly now: number;
  readonly log: StateLog;
}): Promise<void> {
  if (!database) {
    if (insights.enabled) {
      log({ event: 'state-unbound' });
    }
    return;
  }
  await expireRecords({
    database,
    retentionDays: insights.retentionDays,
    now,
    log,
  });
  if (insights.enabled) {
    await reportLastWeek({
      database,
      now,
      settings: {
        weakScore: insights.weakScore,
        stopWords: stopWordsFor(insights.language),
      },
      log,
    });
  }
}

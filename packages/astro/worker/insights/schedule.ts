/**
 * What the Worker's schedule asks of the database (ADR-050, ADR-051): last
 * week's report, then the deletion of what is past its retention.
 *
 * The report comes first, so it is made from the week's records before any
 * of them could go. Retention follows the database, not the recording:
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
  await expireRecords({
    database,
    retentionDays: insights.retentionDays,
    now,
    log,
  });
}

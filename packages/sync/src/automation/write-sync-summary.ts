import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PROJECT_LAYOUT } from '@ctcstack/ctcdocs-core';

import { syncReportSchema } from '../generation/sync-report.js';
import { renderSyncJobSummary } from './sync-summary.js';

export class SyncSummaryError extends Error {
  override readonly name = 'SyncSummaryError';
}

/**
 * Renders the last run's report into the workflow's job summary, so an operator
 * sees what a scheduled sync did without opening the log.
 */
export async function writeSyncSummary(
  repositoryRoot: string,
  environment: Record<string, string | undefined> = process.env,
): Promise<void> {
  const summaryPath = environment.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    throw new SyncSummaryError('GITHUB_STEP_SUMMARY is not configured.');
  }

  const report = syncReportSchema.parse(
    JSON.parse(
      await readFile(
        resolve(repositoryRoot, PROJECT_LAYOUT.syncReportFile),
        'utf8',
      ),
    ),
  );
  await appendFile(
    summaryPath,
    renderSyncJobSummary(report, environment.SYNC_OUTPUT_CHANGED === 'true'),
    'utf8',
  );
  console.log('Sync job summary written.');
}

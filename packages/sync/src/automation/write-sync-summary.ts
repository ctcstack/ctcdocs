import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  loadSiteConfiguration,
  PLATFORM_ROUTE_HREFS,
  PROJECT_LAYOUT,
} from '@ctcstack/ctcdocs-core';

import { syncReportSchema } from '../generation/sync-report.js';
import { titleReportSchema, type TitleReport } from '../titles/title-report.js';
import {
  renderContentHealthSummary,
  renderSyncJobSummary,
} from './sync-summary.js';

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
  const titleReport = titleReportSchema.safeParse(
    JSON.parse(
      await readFile(
        resolve(repositoryRoot, PROJECT_LAYOUT.titleReportFile),
        'utf8',
      ).catch(() => 'null'),
    ),
  );
  if (titleReport.success) {
    const site = loadSiteConfiguration(repositoryRoot);
    await appendFile(
      summaryPath,
      renderContentHealthSummary(
        titleReport.data as unknown as TitleReport,
        `${site.deployment.environments.production.url}${PLATFORM_ROUTE_HREFS.contentHealth}`,
      ),
      'utf8',
    );
  }
  console.log('Sync job summary written.');
}

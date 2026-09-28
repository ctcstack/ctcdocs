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
  renderSiteSummary,
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
  const site = loadSiteConfiguration(repositoryRoot);
  const contentHealthUrl = `${site.deployment.environments.production.url}${PLATFORM_ROUTE_HREFS.contentHealth}`;
  /*
   * The state of the site. What this run changed is written by the sync step
   * itself, which alone knows it (ADR-028).
   */
  await appendFile(
    summaryPath,
    renderSiteSummary(report, contentHealthUrl),
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
    await appendFile(
      summaryPath,
      renderContentHealthSummary(
        titleReport.data as unknown as TitleReport,
        contentHealthUrl,
      ),
      'utf8',
    );
  }
  console.log('Sync job summary written.');
}

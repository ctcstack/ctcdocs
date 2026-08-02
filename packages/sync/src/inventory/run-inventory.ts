import type { SyncConfiguration } from '../config.js';
import type { GoogleAccessTokenProvider } from '../google/auth.js';
import type { SyncContext } from '../project-context.js';
import { GoogleDriveClient } from '../google/drive-client.js';
import { findNavigationOrderIssues } from '../navigation-order.js';
import {
  buildInventorySelection,
  InventoryGraphError,
  type InventorySelection,
} from './inventory-graph.js';
import {
  createInventoryReport,
  type InventoryReport,
} from './inventory-report.js';

export interface InventoryRunResult {
  selection: InventorySelection;
  report: InventoryReport;
}

export interface InventoryRunDependencies {
  fetchImplementation?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  baseUrl?: string;
}

export async function runInventory(
  context: SyncContext,
  configuration: SyncConfiguration,
  accessTokenProvider: GoogleAccessTokenProvider,
  dependencies: InventoryRunDependencies = {},
): Promise<InventoryRunResult> {
  const driveClient = new GoogleDriveClient({
    driveId: configuration.GOOGLE_DRIVE_ID,
    accessTokenProvider,
    maxRetries: configuration.SYNC_MAX_RETRIES,
    timeoutMilliseconds: configuration.SYNC_EXPORT_TIMEOUT_MS,
    ...dependencies,
  });

  await driveClient.validateReadScope(configuration.GOOGLE_ROOT_FOLDER_ID);
  const items = await driveClient.listInventory();
  const graph = buildInventorySelection(
    items,
    configuration.GOOGLE_ROOT_FOLDER_ID,
    configuration.GOOGLE_IGNORED_FOLDER_IDS,
    [configuration.GOOGLE_DRIVE_ID],
  );
  /*
   * How the corpus is named is reported on the same channel as how it is
   * shaped: both are things an editor did in Drive that an operator has to see,
   * and both answer to SYNC_FAIL_ON_WARNING.
   */
  const selection: InventorySelection = {
    ...graph,
    warnings: [
      ...graph.warnings,
      ...findNavigationOrderIssues(
        graph,
        context.site.navigation.landingDocumentTitles,
      ),
    ],
  };
  if (configuration.SYNC_FAIL_ON_WARNING && selection.warnings.length > 0) {
    throw new InventoryGraphError(selection.warnings);
  }
  const report = createInventoryReport(
    selection,
    configuration.GOOGLE_DRIVE_ID,
    configuration.GOOGLE_IGNORED_FOLDER_IDS,
  );

  return { selection, report };
}

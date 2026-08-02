import type { SyncConfiguration } from '../config.js';
import type { GoogleAccessTokenProvider } from '../google/auth.js';
import type { SyncContext } from '../project-context.js';
import { type InventorySelection } from './inventory-graph.js';
import { type InventoryReport } from './inventory-report.js';
export interface InventoryRunResult {
    selection: InventorySelection;
    report: InventoryReport;
}
export interface InventoryRunDependencies {
    fetchImplementation?: typeof fetch;
    sleep?: (milliseconds: number) => Promise<void>;
    baseUrl?: string;
}
export declare function runInventory(context: SyncContext, configuration: SyncConfiguration, accessTokenProvider: GoogleAccessTokenProvider, dependencies?: InventoryRunDependencies): Promise<InventoryRunResult>;

import type { InventoryIssue, InventorySelection } from './inventory-graph.js';
interface InventoryReportItem {
    id: string;
    name: string;
    mimeType: string;
    parentId: string | null;
    path: string[];
    modifiedTime: string;
    createdTime: string;
    webViewLink?: string;
    size?: string;
}
interface InventoryReportFolder extends InventoryReportItem {
    childFolderIds: string[];
    documentIds: string[];
    unsupportedItemIds: string[];
}
export interface InventoryReport {
    schemaVersion: 1;
    scope: {
        driveId: string;
        rootFolderId: string;
        ignoredFolderIds: string[];
    };
    summary: {
        allItems: number;
        descendants: number;
        outsideRoot: number;
        ignored: number;
        folders: number;
        documents: number;
        unsupported: number;
        warnings: number;
    };
    folders: InventoryReportFolder[];
    documents: InventoryReportItem[];
    unsupported: InventoryReportItem[];
    warnings: InventoryIssue[];
}
export declare function createInventoryReport(selection: InventorySelection, driveId: string, ignoredFolderIds: readonly string[]): InventoryReport;
export declare function serializeInventoryReport(report: InventoryReport): string;
export {};

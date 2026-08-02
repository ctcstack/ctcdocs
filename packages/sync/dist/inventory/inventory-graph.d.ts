import { type DriveItem } from '../google/drive-types.js';
export type InventoryIssueCode = 'cycle' | 'duplicate_id' | 'duplicate_navigation_order' | 'ignored_not_found' | 'ignored_not_folder' | 'ignored_outside_root' | 'ignored_root' | 'multiple_landing_documents' | 'multiple_parents' | 'root_not_folder' | 'root_not_found' | 'unrecognized_order_prefix' | 'unresolved_parent';
export interface InventoryIssue {
    code: InventoryIssueCode;
    itemId: string;
    relatedId?: string;
}
export declare class InventoryGraphError extends Error {
    readonly issues: InventoryIssue[];
    readonly name = "InventoryGraphError";
    constructor(issues: InventoryIssue[]);
}
export interface SelectedInventoryItem {
    item: DriveItem;
    parentId: string | null;
    path: string[];
}
export interface InventoryFolderNode extends SelectedInventoryItem {
    childFolderIds: string[];
    documentIds: string[];
    unsupportedItemIds: string[];
}
export interface InventorySelection {
    rootFolderId: string;
    allItemCount: number;
    descendantCount: number;
    outsideRootCount: number;
    ignoredItemCount: number;
    folders: InventoryFolderNode[];
    documents: SelectedInventoryItem[];
    unsupported: SelectedInventoryItem[];
    warnings: InventoryIssue[];
}
export declare function buildInventorySelection(items: readonly DriveItem[], rootFolderId: string, ignoredFolderIds: readonly string[], allowedExternalParentIds?: readonly string[]): InventorySelection;

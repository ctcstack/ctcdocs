import type {
  InventoryFolderNode,
  InventoryIssue,
  InventorySelection,
  SelectedInventoryItem,
} from './inventory-graph.js';

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

function toReportItem(
  selectedItem: SelectedInventoryItem,
): InventoryReportItem {
  const { item } = selectedItem;
  return {
    id: item.id,
    name: item.name,
    mimeType: item.mimeType,
    parentId: selectedItem.parentId,
    path: selectedItem.path,
    modifiedTime: item.modifiedTime,
    createdTime: item.createdTime,
    ...(item.webViewLink ? { webViewLink: item.webViewLink } : {}),
    ...(item.size ? { size: item.size } : {}),
  };
}

function toReportFolder(folder: InventoryFolderNode): InventoryReportFolder {
  return {
    ...toReportItem(folder),
    childFolderIds: folder.childFolderIds,
    documentIds: folder.documentIds,
    unsupportedItemIds: folder.unsupportedItemIds,
  };
}

export function createInventoryReport(
  selection: InventorySelection,
  driveId: string,
  ignoredFolderIds: readonly string[],
): InventoryReport {
  return {
    schemaVersion: 1,
    scope: {
      driveId,
      rootFolderId: selection.rootFolderId,
      ignoredFolderIds: [...new Set(ignoredFolderIds)].sort(),
    },
    summary: {
      allItems: selection.allItemCount,
      descendants: selection.descendantCount,
      outsideRoot: selection.outsideRootCount,
      ignored: selection.ignoredItemCount,
      folders: selection.folders.length,
      documents: selection.documents.length,
      unsupported: selection.unsupported.length,
      warnings: selection.warnings.length,
    },
    folders: selection.folders.map(toReportFolder),
    documents: selection.documents.map(toReportItem),
    unsupported: selection.unsupported.map(toReportItem),
    warnings: selection.warnings,
  };
}

export function serializeInventoryReport(report: InventoryReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

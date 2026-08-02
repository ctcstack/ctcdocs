function toReportItem(selectedItem) {
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
function toReportFolder(folder) {
    return {
        ...toReportItem(folder),
        childFolderIds: folder.childFolderIds,
        documentIds: folder.documentIds,
        unsupportedItemIds: folder.unsupportedItemIds,
    };
}
export function createInventoryReport(selection, driveId, ignoredFolderIds) {
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
export function serializeInventoryReport(report) {
    return `${JSON.stringify(report, null, 2)}\n`;
}

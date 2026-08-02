import { GOOGLE_DRIVE_DOCUMENT_MIME_TYPE, GOOGLE_DRIVE_FOLDER_MIME_TYPE, } from '../google/drive-types.js';
export class InventoryGraphError extends Error {
    issues;
    name = 'InventoryGraphError';
    constructor(issues) {
        super(`Google Drive inventory graph is invalid (${issues.length} issue${issues.length === 1 ? '' : 's'}).`);
        this.issues = issues;
    }
}
function compareText(left, right) {
    if (left < right) {
        return -1;
    }
    if (left > right) {
        return 1;
    }
    return 0;
}
function compareItems(left, right) {
    return compareText(left.name, right.name) || compareText(left.id, right.id);
}
function requireItem(itemsById, itemId) {
    const item = itemsById.get(itemId);
    if (!item) {
        throw new Error(`Inventory graph invariant failed for item ID: ${itemId}`);
    }
    return item;
}
function compareSelectedItems(left, right) {
    return (compareText(left.path.join('/'), right.path.join('/')) ||
        compareText(left.item.id, right.item.id));
}
function collectDescendants(rootId, childrenByParent) {
    const descendants = new Set();
    const pending = [rootId];
    while (pending.length > 0) {
        const itemId = pending.pop();
        if (!itemId || descendants.has(itemId)) {
            continue;
        }
        descendants.add(itemId);
        pending.push(...(childrenByParent.get(itemId) ?? []));
    }
    return descendants;
}
function findGraphIssues(itemsById, allowedExternalParentIds) {
    const issues = [];
    for (const item of [...itemsById.values()].sort(compareItems)) {
        if (item.parents.length > 1) {
            issues.push({ code: 'multiple_parents', itemId: item.id });
        }
        for (const parentId of item.parents) {
            if (!itemsById.has(parentId) && !allowedExternalParentIds.has(parentId)) {
                issues.push({
                    code: 'unresolved_parent',
                    itemId: item.id,
                    relatedId: parentId,
                });
            }
        }
    }
    const stateById = new Map();
    const cycleKeys = new Set();
    function visit(itemId) {
        const state = stateById.get(itemId);
        if (state === 'visited') {
            return;
        }
        if (state === 'visiting') {
            return;
        }
        stateById.set(itemId, 'visiting');
        const item = itemsById.get(itemId);
        for (const parentId of item?.parents ?? []) {
            if (!itemsById.has(parentId)) {
                continue;
            }
            if (stateById.get(parentId) === 'visiting') {
                const cycleKey = [itemId, parentId].sort(compareText).join(':');
                if (!cycleKeys.has(cycleKey)) {
                    cycleKeys.add(cycleKey);
                    issues.push({
                        code: 'cycle',
                        itemId,
                        relatedId: parentId,
                    });
                }
            }
            else {
                visit(parentId);
            }
        }
        stateById.set(itemId, 'visited');
    }
    for (const itemId of [...itemsById.keys()].sort(compareText)) {
        visit(itemId);
    }
    return issues;
}
export function buildInventorySelection(items, rootFolderId, ignoredFolderIds, allowedExternalParentIds = []) {
    const itemsById = new Map();
    const fatalIssues = [];
    for (const item of items) {
        if (itemsById.has(item.id)) {
            fatalIssues.push({ code: 'duplicate_id', itemId: item.id });
            continue;
        }
        itemsById.set(item.id, item);
    }
    const rootFolder = itemsById.get(rootFolderId);
    if (!rootFolder) {
        fatalIssues.push({ code: 'root_not_found', itemId: rootFolderId });
    }
    else if (rootFolder.mimeType !== GOOGLE_DRIVE_FOLDER_MIME_TYPE) {
        fatalIssues.push({ code: 'root_not_folder', itemId: rootFolderId });
    }
    fatalIssues.push(...findGraphIssues(itemsById, new Set(allowedExternalParentIds)));
    if (fatalIssues.length > 0) {
        throw new InventoryGraphError(fatalIssues);
    }
    const childrenByParent = new Map();
    for (const item of itemsById.values()) {
        const parentId = item.parents[0];
        if (!parentId) {
            continue;
        }
        const children = childrenByParent.get(parentId) ?? [];
        children.push(item.id);
        childrenByParent.set(parentId, children);
    }
    for (const [parentId, childIds] of childrenByParent) {
        childIds.sort((leftId, rightId) => compareItems(requireItem(itemsById, leftId), requireItem(itemsById, rightId)));
        childrenByParent.set(parentId, childIds);
    }
    const rootDescendants = collectDescendants(rootFolderId, childrenByParent);
    const ignoredItems = new Set();
    const warnings = [];
    for (const ignoredFolderId of [...new Set(ignoredFolderIds)].sort(compareText)) {
        if (ignoredFolderId === rootFolderId) {
            throw new InventoryGraphError([
                { code: 'ignored_root', itemId: ignoredFolderId },
            ]);
        }
        if (!itemsById.has(ignoredFolderId)) {
            warnings.push({ code: 'ignored_not_found', itemId: ignoredFolderId });
            continue;
        }
        if (requireItem(itemsById, ignoredFolderId).mimeType !==
            GOOGLE_DRIVE_FOLDER_MIME_TYPE) {
            throw new InventoryGraphError([
                { code: 'ignored_not_folder', itemId: ignoredFolderId },
            ]);
        }
        if (!rootDescendants.has(ignoredFolderId)) {
            warnings.push({
                code: 'ignored_outside_root',
                itemId: ignoredFolderId,
            });
            continue;
        }
        for (const itemId of collectDescendants(ignoredFolderId, childrenByParent)) {
            ignoredItems.add(itemId);
        }
    }
    const selectedIds = new Set([...rootDescendants].filter((itemId) => !ignoredItems.has(itemId)));
    const pathsById = new Map([
        [rootFolderId, [requireItem(itemsById, rootFolderId).name]],
    ]);
    function resolvePath(itemId) {
        const existingPath = pathsById.get(itemId);
        if (existingPath) {
            return existingPath;
        }
        const item = requireItem(itemsById, itemId);
        const parentId = item.parents[0];
        const path = parentId && selectedIds.has(parentId)
            ? [...resolvePath(parentId), item.name]
            : [item.name];
        pathsById.set(itemId, path);
        return path;
    }
    const selectedItems = [...selectedIds].map((itemId) => {
        const item = requireItem(itemsById, itemId);
        return {
            item,
            parentId: item.parents[0] ?? null,
            path: resolvePath(itemId),
        };
    });
    selectedItems.sort(compareSelectedItems);
    const folders = selectedItems
        .filter((selectedItem) => selectedItem.item.mimeType === GOOGLE_DRIVE_FOLDER_MIME_TYPE)
        .map((selectedItem) => {
        const selectedChildren = (childrenByParent.get(selectedItem.item.id) ?? [])
            .filter((itemId) => selectedIds.has(itemId))
            .map((itemId) => requireItem(itemsById, itemId));
        return {
            ...selectedItem,
            childFolderIds: selectedChildren
                .filter((item) => item.mimeType === GOOGLE_DRIVE_FOLDER_MIME_TYPE)
                .map((item) => item.id),
            documentIds: selectedChildren
                .filter((item) => item.mimeType === GOOGLE_DRIVE_DOCUMENT_MIME_TYPE)
                .map((item) => item.id),
            unsupportedItemIds: selectedChildren
                .filter((item) => item.mimeType !== GOOGLE_DRIVE_FOLDER_MIME_TYPE &&
                item.mimeType !== GOOGLE_DRIVE_DOCUMENT_MIME_TYPE)
                .map((item) => item.id),
        };
    });
    const documents = selectedItems.filter((selectedItem) => selectedItem.item.mimeType === GOOGLE_DRIVE_DOCUMENT_MIME_TYPE);
    const unsupported = selectedItems.filter((selectedItem) => selectedItem.item.mimeType !== GOOGLE_DRIVE_FOLDER_MIME_TYPE &&
        selectedItem.item.mimeType !== GOOGLE_DRIVE_DOCUMENT_MIME_TYPE);
    return {
        rootFolderId,
        allItemCount: itemsById.size,
        descendantCount: rootDescendants.size,
        outsideRootCount: itemsById.size - rootDescendants.size,
        ignoredItemCount: ignoredItems.size,
        folders,
        documents,
        unsupported,
        warnings,
    };
}

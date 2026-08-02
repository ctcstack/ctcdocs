import { compareNavigationSiblings, } from '../navigation-order.js';
import { parseOrderedLabel } from '../ordered-label.js';
function sibling(selected, kind) {
    return { id: selected.item.id, name: selected.item.name, kind };
}
function documentLink(document, manifest) {
    const record = manifest.documents[document.item.id];
    if (!record) {
        throw new Error('Sidebar generation is missing a document manifest record.');
    }
    return {
        label: parseOrderedLabel(document.item.name).label,
        slug: record.stableSlug,
    };
}
export function createSidebar(selection, manifest, landingTitles) {
    const foldersById = new Map(selection.folders.map((folder) => [folder.item.id, folder]));
    const documentsById = new Map(selection.documents.map((document) => [document.item.id, document]));
    const root = foldersById.get(selection.rootFolderId);
    if (!root) {
        throw new Error('Sidebar generation cannot find the publication root.');
    }
    function buildFolder(folder) {
        const children = [
            ...folder.childFolderIds
                .map((folderId) => foldersById.get(folderId))
                .filter((item) => item !== undefined)
                .map((item) => ({ kind: 'folder', item })),
            ...folder.documentIds
                .map((documentId) => documentsById.get(documentId))
                .filter((item) => item !== undefined)
                .map((item) => ({ kind: 'document', item })),
        ].sort((left, right) => compareNavigationSiblings(sibling(left.item, left.kind), sibling(right.item, right.kind), landingTitles));
        const items = children
            .map((child) => child.kind === 'folder'
            ? buildFolder(child.item)
            : documentLink(child.item, manifest))
            .filter((item) => item !== undefined);
        if (items.length === 0) {
            return undefined;
        }
        return {
            label: parseOrderedLabel(folder.item.name).label,
            items,
        };
    }
    const groups = root.childFolderIds
        .map((folderId) => foldersById.get(folderId))
        .filter((item) => item !== undefined)
        .sort((left, right) => compareNavigationSiblings(sibling(left, 'folder'), sibling(right, 'folder'), landingTitles))
        .map((folder) => buildFolder(folder))
        .filter((item) => item !== undefined);
    const rootDocuments = root.documentIds
        .map((documentId) => documentsById.get(documentId))
        .filter((item) => item !== undefined)
        .sort((left, right) => compareNavigationSiblings(sibling(left, 'document'), sibling(right, 'document'), landingTitles))
        .map((document) => documentLink(document, manifest));
    return rootDocuments.length === 0
        ? groups
        : [{ label: 'General', items: rootDocuments }, ...groups];
}
export function serializeSidebar(sidebar, sourceHeader) {
    return [
        sourceHeader,
        "import type { StarlightUserConfig } from '@astrojs/starlight/types';",
        '',
        `export const generatedSidebar = ${JSON.stringify(sidebar, null, 2)} satisfies NonNullable<StarlightUserConfig['sidebar']>;`,
        '',
    ].join('\n');
}

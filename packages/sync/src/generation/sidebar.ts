import type {
  InventoryFolderNode,
  InventorySelection,
  SelectedInventoryItem,
} from '../inventory/inventory-graph.js';
import type { SyncManifest } from '../manifest.js';
import {
  compareNavigationSiblings,
  type NavigationSibling,
} from '../navigation-order.js';
import { parseOrderedLabel } from '../ordered-label.js';

interface SidebarLink {
  label: string;
  slug: string;
}

interface SidebarGroup {
  label: string;
  items: Array<SidebarGroup | SidebarLink>;
}

function sibling(
  selected: SelectedInventoryItem,
  kind: 'folder' | 'document',
): NavigationSibling {
  return { id: selected.item.id, name: selected.item.name, kind };
}

function documentLink(
  document: SelectedInventoryItem,
  manifest: SyncManifest,
): SidebarLink {
  const record = manifest.documents[document.item.id];
  if (!record) {
    throw new Error(
      'Sidebar generation is missing a document manifest record.',
    );
  }
  return {
    label: parseOrderedLabel(document.item.name).label,
    slug: record.stableSlug,
  };
}

export function createSidebar(
  selection: InventorySelection,
  manifest: SyncManifest,
  landingTitles: readonly string[],
): SidebarGroup[] {
  const foldersById = new Map(
    selection.folders.map((folder) => [folder.item.id, folder]),
  );
  const documentsById = new Map(
    selection.documents.map((document) => [document.item.id, document]),
  );
  const root = foldersById.get(selection.rootFolderId);
  if (!root) {
    throw new Error('Sidebar generation cannot find the publication root.');
  }

  function buildFolder(folder: InventoryFolderNode): SidebarGroup | undefined {
    const children = [
      ...folder.childFolderIds
        .map((folderId) => foldersById.get(folderId))
        .filter((item): item is InventoryFolderNode => item !== undefined)
        .map((item) => ({ kind: 'folder' as const, item })),
      ...folder.documentIds
        .map((documentId) => documentsById.get(documentId))
        .filter((item): item is SelectedInventoryItem => item !== undefined)
        .map((item) => ({ kind: 'document' as const, item })),
    ].sort((left, right) =>
      compareNavigationSiblings(
        sibling(left.item, left.kind),
        sibling(right.item, right.kind),
        landingTitles,
      ),
    );
    const items = children
      .map((child) =>
        child.kind === 'folder'
          ? buildFolder(child.item)
          : documentLink(child.item, manifest),
      )
      .filter((item): item is SidebarGroup | SidebarLink => item !== undefined);
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
    .filter((item): item is InventoryFolderNode => item !== undefined)
    .sort((left, right) =>
      compareNavigationSiblings(
        sibling(left, 'folder'),
        sibling(right, 'folder'),
        landingTitles,
      ),
    )
    .map((folder) => buildFolder(folder))
    .filter((item): item is SidebarGroup => item !== undefined);
  const rootDocuments = root.documentIds
    .map((documentId) => documentsById.get(documentId))
    .filter((item): item is SelectedInventoryItem => item !== undefined)
    .sort((left, right) =>
      compareNavigationSiblings(
        sibling(left, 'document'),
        sibling(right, 'document'),
        landingTitles,
      ),
    )
    .map((document) => documentLink(document, manifest));

  return rootDocuments.length === 0
    ? groups
    : [{ label: 'General', items: rootDocuments }, ...groups];
}

export function serializeSidebar(
  sidebar: readonly SidebarGroup[],
  sourceHeader: string,
): string {
  return [
    sourceHeader,
    "import type { StarlightUserConfig } from '@astrojs/starlight/types';",
    '',
    `export const generatedSidebar = ${JSON.stringify(sidebar, null, 2)} satisfies NonNullable<StarlightUserConfig['sidebar']>;`,
    '',
  ].join('\n');
}

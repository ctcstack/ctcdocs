import { DOCUMENT_FORMAT_BADGES } from '@ctcstack/ctcdocs-core';

import { documentName } from '../google/drive-types.js';
import type {
  InventoryFolderNode,
  InventorySelection,
  SelectedInventoryItem,
} from '../inventory/inventory-graph.js';
import { documentFormat, type SyncManifest } from '../manifest.js';
import {
  compareNavigationSiblings,
  isLandingTitle,
  type NavigationSibling,
} from '../navigation-order.js';
import { parseOrderedLabel } from '../ordered-label.js';

interface SidebarLink {
  label: string;
  slug: string;
  /**
   * Marks a page that presents a PDF (ADR-027), a spreadsheet (ADR-046) or a
   * recording (ADR-047) rather than a document.
   */
  badge?: string;
  /**
   * A folder's page names its folder here, since its label names only what
   * it is. Screen readers read it, and the previous and next links show it.
   */
  attrs?: { 'aria-label': string };
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
  const badge = DOCUMENT_FORMAT_BADGES[documentFormat(record)];
  return {
    label: parseOrderedLabel(documentName(document.item)).label,
    slug: record.stableSlug,
    ...(badge ? { badge } : {}),
  };
}

/**
 * A folder's own page, as the first item of its group, when the folder holds
 * no document with a landing title (ADR-035). Such a document, numbered or
 * not, stands in for the page, so the page stays out and the group never
 * shows two entries with one name; for the same reason it stays out beside a
 * subfolder with its label. Otherwise the page takes the first landing title
 * as its label, and names its folder for screen readers and for the previous
 * and next links. There is no page to show when the project does not generate
 * folder pages.
 */
function folderPage(
  folder: InventoryFolderNode,
  documents: readonly SelectedInventoryItem[],
  subfolderLabels: readonly string[],
  manifest: SyncManifest,
  landingTitles: readonly string[],
): SidebarLink | undefined {
  const record = manifest.folders[folder.item.id];
  const [label] = landingTitles;
  if (!record?.stableSlug || !record.generatedMarkdownPath || !label) {
    return undefined;
  }
  const hasLandingDocument = documents.some((document) =>
    isLandingTitle(
      parseOrderedLabel(documentName(document.item)).label,
      landingTitles,
    ),
  );
  const hasNamesake = subfolderLabels.some((subfolder) =>
    isLandingTitle(subfolder, [label]),
  );
  if (hasLandingDocument || hasNamesake) {
    return undefined;
  }
  // Without the trailing slash a Drive folder name can carry, which the site
  // drops from group labels where it shows them.
  const folderLabel = parseOrderedLabel(folder.item.name)
    .label.replace(/\/+$/u, '')
    .trim();
  return {
    label,
    slug: record.stableSlug,
    attrs: { 'aria-label': `${folderLabel}: ${label}` },
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
    const page = folderPage(
      folder,
      children.flatMap((child) =>
        child.kind === 'document' ? [child.item] : [],
      ),
      items.flatMap((item) => ('items' in item ? [item.label] : [])),
      manifest,
      landingTitles,
    );
    return {
      label: parseOrderedLabel(folder.item.name).label,
      items: page ? [page, ...items] : items,
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

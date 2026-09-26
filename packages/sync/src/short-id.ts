import { createHash } from 'node:crypto';

import type { SelectedInventoryItem } from './inventory/inventory-graph.js';
import type { SyncManifest } from './manifest.js';

/** Six hexadecimal characters: sixteen million values for a few hundred items. */
const SHORT_ID_LENGTH = 6;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function hashOf(itemId: string): string {
  return createHash('sha256').update(itemId).digest('hex');
}

/**
 * Gives every published folder and document a short ID (ADR-022).
 *
 * A short ID is the leading characters of the SHA-256 of the item's Drive ID:
 * six, or two more at a time while the shorter prefix belongs to another item.
 * It is recorded in the manifest on first discovery and carried forward from
 * then on, so a permanent link never changes, even when a later item's prefix
 * would have claimed it first.
 *
 * Folders and documents share one namespace, because `/d/<short ID>/` does not
 * say which it leads to. Items the manifest records are placed first, in ID
 * order, then new ones, also in ID order, so the result does not depend on the
 * order Drive lists them in.
 */
export function allocateShortIds(
  folders: readonly SelectedInventoryItem[],
  documents: readonly SelectedInventoryItem[],
  existingManifest: SyncManifest,
  rootFolderId: string,
): Map<string, string> {
  const recorded = new Map<string, string>();
  for (const [fileId, record] of Object.entries(existingManifest.documents)) {
    if (record.shortId) {
      recorded.set(fileId, record.shortId);
    }
  }
  for (const [folderId, record] of Object.entries(existingManifest.folders)) {
    if (record.shortId) {
      recorded.set(folderId, record.shortId);
    }
  }

  const itemIds = [
    ...folders
      .map((folder) => folder.item.id)
      .filter((folderId) => folderId !== rootFolderId),
    ...documents.map((document) => document.item.id),
  ].sort(compareText);
  /*
   * Every recorded short ID stays taken for this run, including those of items
   * outside the current selection: a targeted sync carries them forward
   * untouched, and a deleted item's ID is not handed to a newcomer in the run
   * that removes it.
   */
  const taken = new Set<string>();
  for (const shortId of [...recorded.values()].sort(compareText)) {
    if (taken.has(shortId)) {
      throw new Error('The existing manifest contains duplicate short IDs.');
    }
    taken.add(shortId);
  }
  const result = new Map<string, string>();
  for (const itemId of itemIds) {
    const shortId = recorded.get(itemId);
    if (shortId !== undefined) {
      result.set(itemId, shortId);
    }
  }
  for (const itemId of itemIds) {
    if (result.has(itemId)) {
      continue;
    }
    const hash = hashOf(itemId);
    let length = SHORT_ID_LENGTH;
    while (taken.has(hash.slice(0, length))) {
      length += 2;
      if (length > hash.length) {
        throw new Error('Unable to allocate a unique short ID.');
      }
    }
    const shortId = hash.slice(0, length);
    taken.add(shortId);
    result.set(itemId, shortId);
  }
  return result;
}

import { createHash } from 'node:crypto';

import { RESERVED_SLUGS } from '@ctcstack/ctcdocs-core';

import type { SelectedInventoryItem } from './inventory/inventory-graph.js';
import type { SyncManifest } from './manifest.js';
import { parseOrderedLabel } from './ordered-label.js';

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function slugifySegment(value: string): string {
  const label = parseOrderedLabel(value)
    .label.normalize('NFKD')
    .replace(/\p{Mark}+/gu, '')
    .toLocaleLowerCase('en');
  const slug = label
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return slug || 'untitled';
}

function proposedSlug(item: SelectedInventoryItem): string {
  const relativePath = item.path.slice(1);
  return relativePath.map(slugifySegment).join('/');
}

function collisionSuffix(fileId: string, length: number): string {
  return createHash('sha256').update(fileId).digest('hex').slice(0, length);
}

function allocateUniqueSlug(
  baseSlug: string,
  fileId: string,
  allocatedSlugs: ReadonlySet<string>,
): string {
  if (!allocatedSlugs.has(baseSlug)) {
    return baseSlug;
  }
  for (let suffixLength = 6; suffixLength <= 64; suffixLength += 2) {
    const candidate = `${baseSlug}--${collisionSuffix(fileId, suffixLength)}`;
    if (!allocatedSlugs.has(candidate)) {
      return candidate;
    }
  }
  throw new Error('Unable to allocate a unique stable slug.');
}

export interface StableSlugAllocation {
  /** Folder identifier to section address, excluding the publication root. */
  folders: Map<string, string>;
  /** Google file identifier to document address. */
  documents: Map<string, string>;
}

/** Carries forward the addresses the manifest already owns, in id order. */
function preserveAllocated(
  existing: ReadonlyArray<readonly [string, string | undefined]>,
  currentIds: ReadonlySet<string>,
  allocatedSlugs: Set<string>,
  result: Map<string, string>,
): void {
  for (const [itemId, stableSlug] of [...existing].sort(([left], [right]) =>
    compareText(left, right),
  )) {
    if (!currentIds.has(itemId) || stableSlug === undefined) {
      continue;
    }
    if (allocatedSlugs.has(stableSlug)) {
      throw new Error('The existing manifest contains duplicate stable slugs.');
    }
    allocatedSlugs.add(stableSlug);
    result.set(itemId, stableSlug);
  }
}

/** Allocates the items that have no address yet, shortest base slug first. */
function allocateRemaining(
  items: readonly SelectedInventoryItem[],
  allocatedSlugs: Set<string>,
  result: Map<string, string>,
): void {
  const pending = items
    .filter((item) => !result.has(item.item.id))
    .map((item) => ({ item, baseSlug: proposedSlug(item) }))
    .filter(({ baseSlug }) => baseSlug.length > 0)
    .sort(
      (left, right) =>
        compareText(left.baseSlug, right.baseSlug) ||
        compareText(left.item.item.id, right.item.item.id),
    );

  for (const { item, baseSlug } of pending) {
    const stableSlug = allocateUniqueSlug(
      baseSlug,
      item.item.id,
      allocatedSlugs,
    );
    allocatedSlugs.add(stableSlug);
    result.set(item.item.id, stableSlug);
  }
}

/**
 * Allocates the addresses of the whole corpus in one pass, because folders and
 * documents share one namespace: `/company/` and a document called "Company"
 * are the same URL.
 *
 * Order of precedence, and the reason for it:
 *
 * 1. Addresses the manifest already owns, documents before folders. A published
 *    document URL is the thing readers have saved, so it never moves to make
 *    room for a section page.
 * 2. New folders, so that a folder claims its own name before a document
 *    arriving in the same run can take it.
 * 3. New documents.
 *
 * The publication root allocates nothing: its relative path is empty, and `/`
 * is the home page. See docs/ADR/014-section-index-pages.md.
 *
 * The addresses the platform serves itself are reserved alongside them, after
 * the manifest's own addresses are carried forward: a new folder or document
 * whose name yields one takes a suffixed slug instead, rather than being
 * published at an address a platform route would shadow.
 */
export function allocateStableSlugs(
  folders: readonly SelectedInventoryItem[],
  documents: readonly SelectedInventoryItem[],
  existingManifest: SyncManifest,
): StableSlugAllocation {
  const allocatedSlugs = new Set(Object.keys(existingManifest.redirects));
  const allocatedDocuments = new Map<string, string>();
  const allocatedFolders = new Map<string, string>();

  preserveAllocated(
    Object.entries(existingManifest.documents).map(
      ([fileId, record]) => [fileId, record.stableSlug] as const,
    ),
    new Set(documents.map((document) => document.item.id)),
    allocatedSlugs,
    allocatedDocuments,
  );
  preserveAllocated(
    Object.entries(existingManifest.folders).map(
      ([folderId, record]) => [folderId, record.stableSlug] as const,
    ),
    new Set(folders.map((folder) => folder.item.id)),
    allocatedSlugs,
    allocatedFolders,
  );
  /*
   * Reserved after the carry-forward rather than before it, because an address
   * the corpus already owns is a published URL: a deployment that predates a
   * platform route keeps its address and validation reports the clash, which
   * is a decision for an operator rather than a silent move.
   */
  for (const slug of RESERVED_SLUGS) {
    allocatedSlugs.add(slug);
  }
  allocateRemaining(folders, allocatedSlugs, allocatedFolders);
  allocateRemaining(documents, allocatedSlugs, allocatedDocuments);

  return { folders: allocatedFolders, documents: allocatedDocuments };
}

export function allocateReseededSlug(
  document: SelectedInventoryItem,
  existingManifest: SyncManifest,
): string {
  const allocatedSlugs = new Set([
    ...Object.keys(existingManifest.redirects),
    ...RESERVED_SLUGS,
    ...Object.values(existingManifest.documents)
      .filter((record) => record.googleFileId !== document.item.id)
      .map((record) => record.stableSlug),
  ]);
  return allocateUniqueSlug(
    proposedSlug(document),
    document.item.id,
    allocatedSlugs,
  );
}

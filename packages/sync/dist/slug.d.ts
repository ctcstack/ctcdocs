import type { SelectedInventoryItem } from './inventory/inventory-graph.js';
import type { SyncManifest } from './manifest.js';
export declare function slugifySegment(value: string): string;
export interface StableSlugAllocation {
    /** Folder identifier to section address, excluding the publication root. */
    folders: Map<string, string>;
    /** Google file identifier to document address. */
    documents: Map<string, string>;
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
 */
export declare function allocateStableSlugs(folders: readonly SelectedInventoryItem[], documents: readonly SelectedInventoryItem[], existingManifest: SyncManifest): StableSlugAllocation;
export declare function allocateReseededSlug(document: SelectedInventoryItem, existingManifest: SyncManifest): string;

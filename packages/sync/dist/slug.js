import { createHash } from 'node:crypto';
import { parseOrderedLabel } from './ordered-label.js';
function compareText(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
export function slugifySegment(value) {
    const label = parseOrderedLabel(value)
        .label.normalize('NFKD')
        .replace(/\p{Mark}+/gu, '')
        .toLocaleLowerCase('en');
    const slug = label
        .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
        .replace(/^-+|-+$/gu, '');
    return slug || 'untitled';
}
function proposedSlug(item) {
    const relativePath = item.path.slice(1);
    return relativePath.map(slugifySegment).join('/');
}
function collisionSuffix(fileId, length) {
    return createHash('sha256').update(fileId).digest('hex').slice(0, length);
}
function allocateUniqueSlug(baseSlug, fileId, allocatedSlugs) {
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
/** Carries forward the addresses the manifest already owns, in id order. */
function preserveAllocated(existing, currentIds, allocatedSlugs, result) {
    for (const [itemId, stableSlug] of [...existing].sort(([left], [right]) => compareText(left, right))) {
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
function allocateRemaining(items, allocatedSlugs, result) {
    const pending = items
        .filter((item) => !result.has(item.item.id))
        .map((item) => ({ item, baseSlug: proposedSlug(item) }))
        .filter(({ baseSlug }) => baseSlug.length > 0)
        .sort((left, right) => compareText(left.baseSlug, right.baseSlug) ||
        compareText(left.item.item.id, right.item.item.id));
    for (const { item, baseSlug } of pending) {
        const stableSlug = allocateUniqueSlug(baseSlug, item.item.id, allocatedSlugs);
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
 */
export function allocateStableSlugs(folders, documents, existingManifest) {
    const allocatedSlugs = new Set(Object.keys(existingManifest.redirects));
    const allocatedDocuments = new Map();
    const allocatedFolders = new Map();
    preserveAllocated(Object.entries(existingManifest.documents).map(([fileId, record]) => [fileId, record.stableSlug]), new Set(documents.map((document) => document.item.id)), allocatedSlugs, allocatedDocuments);
    preserveAllocated(Object.entries(existingManifest.folders).map(([folderId, record]) => [folderId, record.stableSlug]), new Set(folders.map((folder) => folder.item.id)), allocatedSlugs, allocatedFolders);
    allocateRemaining(folders, allocatedSlugs, allocatedFolders);
    allocateRemaining(documents, allocatedSlugs, allocatedDocuments);
    return { folders: allocatedFolders, documents: allocatedDocuments };
}
export function allocateReseededSlug(document, existingManifest) {
    const allocatedSlugs = new Set([
        ...Object.keys(existingManifest.redirects),
        ...Object.values(existingManifest.documents)
            .filter((record) => record.googleFileId !== document.item.id)
            .map((record) => record.stableSlug),
    ]);
    return allocateUniqueSlug(proposedSlug(document), document.item.id, allocatedSlugs);
}

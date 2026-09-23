/**
 * The rows a section page draws, from the entries its frontmatter records.
 *
 * The generated page says what each entry is and how many documents a folder
 * holds; everything a reader sees beyond that — the name, the description, the
 * date the source was last edited — is read from the page the entry points
 * at, so the listing and the page it leads to can never disagree.
 *
 * Nothing here decides order: the pipeline already wrote the entries in the
 * order the sidebar uses. See docs/ADR/019-folders-before-documents.md.
 */

export type SectionEntry =
  | { kind: 'folder'; slug: string; documentCount: number }
  | { kind: 'document'; slug: string };

/** What the listing needs to know about a page in the collection. */
export interface ListedPage {
  sourceType: string;
  title: string;
  description: string | undefined;
  googleModifiedTime: string | undefined;
}

export type SectionListingRow =
  | { kind: 'folder'; href: string; label: string; documentCount: number }
  | {
      kind: 'document';
      href: string;
      label: string;
      description: string | undefined;
      modified: Date | undefined;
    };

/** The page kind an entry must point at, so a folder is never drawn as a page. */
const EXPECTED_SOURCE = {
  folder: 'section-index',
  document: 'google-doc',
} as const;

/**
 * Returns the rows to draw, or `undefined` when the page should show its own
 * Markdown list instead: it was generated before entries existed, it lists
 * nothing, or an entry points at a page that is not there. The Markdown list
 * is always correct, so falling back to it is never wrong — only plainer.
 */
export function sectionListingRows(
  entries: readonly SectionEntry[] | undefined,
  pages: ReadonlyMap<string, ListedPage>,
): SectionListingRow[] | undefined {
  if (!entries || entries.length === 0) {
    return undefined;
  }
  const rows: SectionListingRow[] = [];
  for (const entry of entries) {
    const page = pages.get(entry.slug);
    if (!page || page.sourceType !== EXPECTED_SOURCE[entry.kind]) {
      return undefined;
    }
    const href = `/${entry.slug}/`;
    if (entry.kind === 'folder') {
      rows.push({
        kind: 'folder',
        href,
        label: page.title,
        documentCount: entry.documentCount,
      });
    } else {
      const description = page.description?.replace(/\s+/gu, ' ').trim();
      rows.push({
        kind: 'document',
        href,
        label: page.title,
        description: description ? description : undefined,
        modified: page.googleModifiedTime
          ? new Date(page.googleModifiedTime)
          : undefined,
      });
    }
  }
  return rows;
}

/** How much a folder holds, in the words its row shows. */
export function documentCountLabel(count: number): string {
  if (count === 0) return 'Empty';
  return count === 1 ? '1 document' : `${count} documents`;
}

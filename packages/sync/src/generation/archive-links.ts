/**
 * Which archives the published pages hand their readers, and which pages do
 * nothing else off the site (ADR-054).
 *
 * The site does not open archives. A page that explains a process and links
 * to the archive its readers download is how that archive reaches them, so
 * neither the archive nor the link is work for an editor. Read from the
 * published output, so an unchanged Drive gives the same answer.
 */
import { documentLinks } from '../links/document-links.js';

export interface ArchiveLinks {
  /** Archives a published page links to, by Drive ID. */
  linked: ReadonlySet<string>;
  /**
   * Pages whose every link the sync notes for leaving the site leads to an
   * archive, by Drive ID.
   */
  onlyToArchives: ReadonlySet<string>;
}

/**
 * `bodies` holds each published page's body by its Drive ID, `archives` the
 * archives under the root, and `published` the Drive IDs the site publishes.
 */
export function archiveLinks(
  bodies: ReadonlyMap<string, string>,
  archives: ReadonlySet<string>,
  published: ReadonlySet<string>,
  siteOrigins: readonly string[],
): ArchiveLinks {
  const linked = new Set<string>();
  const onlyToArchives = new Set<string>();
  if (archives.size === 0) {
    return { linked, onlyToArchives };
  }
  for (const [fileId, body] of bodies) {
    const noted: string[] = [];
    for (const link of documentLinks(body, siteOrigins)) {
      if (
        (link.kind === 'google' || link.kind === 'download') &&
        archives.has(link.fileId)
      ) {
        linked.add(link.fileId);
      }
      // The links the sync notes: a typed Google address off the site.
      if (link.kind === 'google' && link.typed && !published.has(link.fileId)) {
        noted.push(link.fileId);
      }
    }
    if (noted.length > 0 && noted.every((id) => archives.has(id))) {
      onlyToArchives.add(fileId);
    }
  }
  return { linked, onlyToArchives };
}

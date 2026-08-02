/**
 * Where a Drive folder points.
 *
 * A folder gets a page of its own when `navigation.sectionIndexPages` is on,
 * and that page is the natural destination for a breadcrumb segment or a
 * folder card. Nothing here needs to know whether the switch is on: the pages
 * are entries in the content collection, so when there are none this map is
 * empty and every caller falls back to the home index anchor it used before.
 *
 * See docs/ADR/014-section-index-pages.md.
 */
import { getCollection } from 'astro:content';

import { folderTrail, normalizeFolderName } from './folder-anchor';

/** Folder trail to the href of its page. */
export type SectionHrefs = ReadonlyMap<string, string>;

/*
 * Folder labels are Drive names and may contain any character a person can
 * type, including the separators a joined key would use. A control character
 * cannot appear in a Drive name, so it is the one safe joiner.
 */
const TRAIL_SEPARATOR = '\u0000';

function trailKey(trail: readonly string[]): string {
  return trail.map(normalizeFolderName).join(TRAIL_SEPARATOR);
}

export async function loadSectionHrefs(): Promise<SectionHrefs> {
  const sections = await getCollection(
    'docs',
    ({ data }) => data.sourceType === 'section-index',
  );
  return new Map(
    sections.map((section) => [
      trailKey([...folderTrail(section.data.folderPath), section.data.title]),
      `/${section.id}/`,
    ]),
  );
}

/** The page for the folder at the end of `trail`, when it has one. */
export function sectionHref(
  sections: SectionHrefs,
  trail: readonly string[],
): string | undefined {
  return trail.length === 0 ? undefined : sections.get(trailKey(trail));
}

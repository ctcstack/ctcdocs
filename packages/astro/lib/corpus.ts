/**
 * The synchronized corpus, shaped for the home page.
 *
 * Every block on the home page reads the same structure, so the card grid, the
 * recent band, and the full index can never disagree about what exists or how
 * fresh it is.
 *
 * Freshness always comes from `googleModifiedTime` — when a person last edited
 * the Google Doc — never from `syncedAt`, which changes on every pipeline run
 * and would report the whole corpus as fresh after any sync.
 */
import { siteConfiguration } from './project.js';
import { getCollection } from 'astro:content';

import { folderAnchorId, folderTrail } from './folder-anchor';
import { loadSectionHrefs, sectionHref } from './sections';

/** Documents at the Drive root are grouped under this heading. */
const ROOT_GROUP = 'General';

/**
 * The document that speaks for its folder is the one the sidebar opens the
 * folder with, so both read the same configured list rather than each keeping
 * an idea of what a landing document is called. A folder gets a description by
 * having such a document in it, which keeps editors in Google Docs rather than
 * asking them to edit this repository.
 */
const DESCRIPTION_DOC_TITLES =
  siteConfiguration.navigation.landingDocumentTitles.map((title) =>
    title.toLowerCase(),
  );

export type CorpusDocument = {
  description: string | undefined;
  folder: string;
  href: string;
  modified: Date | undefined;
  /** Sub-folder path, when the document sits deeper than the top level. */
  qualifier: string | undefined;
  title: string;
};

export type CorpusGroup = {
  description: string | undefined;
  documents: CorpusDocument[];
  /** Anchor of this group's heading in the full index below. */
  id: string;
  label: string;
  /**
   * Where the folder itself leads: its own page when one is generated, and
   * otherwise this group's heading in the index on this page.
   */
  href: string;
};

export type Corpus = {
  documentCount: number;
  groups: CorpusGroup[];
  latestChange: Date | undefined;
  /** Every document, most recently edited first. */
  recent: CorpusDocument[];
};

/**
 * Most recently edited first. A document with no recorded source modification
 * time sorts last rather than being dropped: an unknown date is still a
 * document someone may need.
 *
 * The collation locale is pinned. An unqualified `localeCompare` follows the
 * build machine's default locale, which would make the emitted order depend on
 * where the site was built; titles here are multilingual, so that is not a
 * theoretical concern.
 */
function byRecency(a: CorpusDocument, b: CorpusDocument): number {
  if (!a.modified && !b.modified) return a.title.localeCompare(b.title, 'en');
  if (!a.modified) return 1;
  if (!b.modified) return -1;
  return b.modified.getTime() - a.modified.getTime();
}

function newestEdit(group: CorpusGroup): number {
  const times = group.documents
    .map((entry) => entry.modified?.getTime())
    .filter((time): time is number => typeof time === 'number');
  return times.length > 0 ? Math.max(...times) : Number.NEGATIVE_INFINITY;
}

/** Picks the description a folder publishes about itself, when it has one. */
function folderDescription(
  label: string,
  documents: CorpusDocument[],
): string | undefined {
  const wanted = new Set([...DESCRIPTION_DOC_TITLES, label.toLowerCase()]);
  const marker = documents.find((entry) =>
    wanted.has(entry.title.trim().toLowerCase()),
  );
  const description = marker?.description?.trim();
  return description ? description : undefined;
}

export async function loadCorpus(): Promise<Corpus> {
  const docs = await getCollection('docs');
  const synced = docs.filter((doc) => doc.data.sourceType === 'google-doc');
  const sections = await loadSectionHrefs();

  const groups = new Map<string, CorpusGroup>();
  const all: CorpusDocument[] = [];

  for (const doc of synced) {
    const trail = folderTrail(doc.data.folderPath);
    const label = trail[0] ?? ROOT_GROUP;
    const modifiedRaw = doc.data.googleModifiedTime;
    const description = doc.data.description?.trim();

    const entry: CorpusDocument = {
      description: description ? description : undefined,
      folder: label,
      href: `/${doc.id}/`,
      modified: modifiedRaw ? new Date(modifiedRaw) : undefined,
      // Deeper folders are shown on the row rather than as their own group,
      // which would fragment the index at this corpus size.
      qualifier: trail.length > 1 ? trail.slice(1).join(' / ') : undefined,
      title: doc.data.title,
    };

    all.push(entry);

    const anchor = folderAnchorId(label);
    const group = groups.get(label) ?? {
      description: undefined,
      documents: [],
      id: anchor,
      label,
      /*
       * Documents at the Drive root are grouped under a heading that is not a
       * folder, so that group never has a page — it points at itself in the
       * index below.
       */
      href:
        (trail.length > 0 ? sectionHref(sections, [label]) : undefined) ??
        `#${anchor}`,
    };
    group.documents.push(entry);
    groups.set(label, group);
  }

  for (const group of groups.values()) {
    group.documents.sort(byRecency);
    group.description = folderDescription(group.label, group.documents);
  }

  /*
   * Groups are ordered the way their documents are: the folder someone touched
   * most recently opens the page. A folder with no dated document sorts last,
   * by name.
   */
  const ordered = [...groups.values()].sort((a, b) => {
    const difference = newestEdit(b) - newestEdit(a);
    return Number.isNaN(difference) || difference === 0
      ? a.label.localeCompare(b.label, 'en')
      : difference;
  });

  const recent = [...all].sort(byRecency);

  return {
    documentCount: synced.length,
    groups: ordered,
    latestChange: recent.find((entry) => entry.modified)?.modified,
    recent,
  };
}

/** Absolute date in UTC, so the emitted bytes never depend on the clock. */
export function formatDate(value: Date): string {
  return value.toLocaleDateString('en', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  });
}

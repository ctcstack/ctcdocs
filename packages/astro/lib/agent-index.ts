/**
 * The `llms.txt` indexes: a map of the corpus for AI agents.
 *
 * Every document already has a Markdown version at its address plus
 * `index.md` (ADR-010). What an agent lacked was a way to find them without
 * crawling the HTML: this module lists every published document once, under
 * its folder, with the address of its Markdown version and its description.
 * A top-level folder with a page of its own also gets an index of its own, so
 * an agent working in one part of the corpus can read only that part.
 *
 * Order is the reader's order. The indexes walk the same generated sidebar the
 * site renders, so the editorial order the pipeline derives from Drive names
 * (ADR-013) reaches agents unchanged, and the output is a pure function of the
 * corpus: the same input always produces the same bytes.
 *
 * See docs/ADR/033-publish-llms-txt-indexes.md.
 */
import { markdownProjectionPath, MEMBERS_CLASS } from '@ctcstack/ctcdocs-core';
import {
  DOCUMENT_FORMAT_NOUNS,
  type DocumentFormat,
} from '@ctcstack/ctcdocs-core/document-format';
import { inlineMarkdown } from '@ctcstack/ctcdocs-core/published-markdown';

import { normalizeFolderName } from './folder-anchor.js';
import { oneLine } from './text.js';

/**
 * An item of the generated sidebar, read structurally. The sidebar is
 * Starlight's configuration, but nothing here needs Starlight: a group has a
 * label and items, a link to a document has a slug, and a bare string is the
 * slug shorthand. Anything else, such as an external link, is not a document
 * and is skipped.
 */
export type NavigationItem =
  | string
  | {
      readonly label?: unknown;
      readonly slug?: unknown;
      readonly items?: unknown;
    };

/** What an index shows for a document. */
export interface IndexedDocument {
  title: string;
  description: string | undefined;
  /**
   * What the page publishes, a Google Doc when absent. The sidebar badges any
   * other kind; the index says it in the link text, `(PDF)`, `(spreadsheet)`,
   * `(video)`, which also tells apart a document and a PDF that share a name.
   */
  format?: DocumentFormat;
  /**
   * The document's access class (ADR-039). An index describes only documents
   * of its own class and lists the rest by title and address; without one, a
   * document is in the members class.
   */
  classId?: string;
}

export interface AgentIndexSite {
  title: string;
  description: string | undefined;
}

interface AgentIndexEntry {
  slug: string;
  title: string;
  description: string | undefined;
  format: DocumentFormat;
  classId: string;
}

export interface AgentIndexSection {
  /** Folder names from the top of the tree to this folder. */
  trail: readonly string[];
  /**
   * Where this folder's own index is served. Only a top-level folder with a
   * page of its own has one.
   */
  indexPath: string | undefined;
  documents: AgentIndexEntry[];
  children: AgentIndexSection[];
}

/** Heading for documents the sidebar puts outside any group. */
const UNGROUPED_LABEL = 'Documents';

/**
 * Heading for documents the sidebar does not list. The sync lists every
 * document, so this is a safety net: an index that silently dropped a page
 * would be worse than one that files it at the end.
 */
const UNLISTED_LABEL = 'Other documents';

function isGroup(
  item: NavigationItem,
): item is { label?: unknown; items: readonly NavigationItem[] } {
  return typeof item === 'object' && Array.isArray(item.items);
}

function slugOf(item: NavigationItem): string | undefined {
  if (typeof item === 'string') {
    return item;
  }
  return typeof item.slug === 'string' ? item.slug : undefined;
}

function hasDocuments(section: AgentIndexSection): boolean {
  return (
    section.documents.length > 0 ||
    section.children.some((child) => hasDocuments(child))
  );
}

/**
 * Builds the tree both kinds of index render, from the sidebar the site
 * renders and the documents that have a Markdown version.
 *
 * `sectionHref` answers where a folder's own page is, by folder trail, the way
 * the rest of the site finds it (see `sections.ts`); a folder without one gets
 * no index of its own. Items that are not documents with a Markdown version —
 * section pages, hand-written pages, external links — are skipped, and folders
 * left with nothing to list are dropped.
 */
export function buildAgentIndex(
  navigation: readonly NavigationItem[],
  documents: ReadonlyMap<string, IndexedDocument>,
  sectionHref: (trail: readonly string[]) => string | undefined,
): AgentIndexSection[] {
  const listed = new Set<string>();

  function entry(slug: string): AgentIndexEntry | undefined {
    const document = documents.get(slug);
    if (!document || listed.has(slug)) {
      return undefined;
    }
    listed.add(slug);
    return entryOf(slug, document);
  }

  function section(
    trail: readonly string[],
    items: readonly NavigationItem[],
  ): AgentIndexSection {
    const node: AgentIndexSection = {
      trail,
      indexPath: undefined,
      documents: [],
      children: [],
    };
    for (const item of items) {
      if (isGroup(item)) {
        const label = normalizeFolderName(String(item.label ?? ''));
        const child = section([...trail, label], item.items);
        if (hasDocuments(child)) {
          node.children.push(child);
        }
        continue;
      }
      const slug = slugOf(item);
      const indexed = slug ? entry(slug) : undefined;
      if (indexed) {
        node.documents.push(indexed);
      }
    }
    return node;
  }

  const root = section([], navigation);
  const sections = [...root.children];
  /*
   * Drive lets two folders in one parent share a name, and a folder's page is
   * found by its name, so two top-level groups can resolve to one page. Only
   * the first gets that page's index: a second would be written over the first
   * at the same address. Both folders' documents stay in the site index.
   */
  const claimed = new Set<string>();
  for (const top of sections) {
    const href = sectionHref(top.trail);
    if (href && !claimed.has(href)) {
      claimed.add(href);
      top.indexPath = `${href}llms.txt`;
    }
  }
  if (root.documents.length > 0) {
    sections.unshift({
      trail: [UNGROUPED_LABEL],
      indexPath: undefined,
      documents: root.documents,
      children: [],
    });
  }

  /*
   * The collation locale is pinned, as everywhere else on the site, so the
   * order cannot depend on the machine that builds it.
   */
  const unlisted = [...documents.entries()]
    .filter(([slug]) => !listed.has(slug))
    .map(([slug, document]) => entryOf(slug, document))
    .sort(
      (a, b) =>
        a.title.localeCompare(b.title, 'en') ||
        a.slug.localeCompare(b.slug, 'en'),
    );
  if (unlisted.length > 0) {
    sections.push({
      trail: [UNLISTED_LABEL],
      indexPath: undefined,
      documents: unlisted,
      children: [],
    });
  }

  return sections;
}

function entryOf(slug: string, document: IndexedDocument): AgentIndexEntry {
  return {
    slug,
    title: document.title,
    description: oneLine(document.description),
    format: document.format ?? 'google-doc',
    classId: document.classId ?? MEMBERS_CLASS,
  };
}

/**
 * A description is a document's own text, so it is shown only in an index of
 * the document's class; elsewhere the document keeps its title and address.
 */
function documentLine(document: AgentIndexEntry, indexClass: string): string {
  const title = inlineMarkdown(document.title);
  const noun = DOCUMENT_FORMAT_NOUNS[document.format];
  const kind = noun ? ` (${noun})` : '';
  const link = `- [${title}${kind}](${markdownProjectionPath(document.slug)})`;
  return document.description && document.classId === indexClass
    ? `${link}: ${inlineMarkdown(document.description)}`
    : link;
}

/**
 * One `##` heading per folder that lists documents, deepest folders named by
 * their whole trail. The llms.txt format has only one level of file list, so
 * the hierarchy is carried by the heading rather than by nesting.
 */
function sectionLines(
  section: AgentIndexSection,
  { linkOwnIndex, indexClass }: { linkOwnIndex: boolean; indexClass: string },
): string[] {
  const lines: string[] = [];
  const ownIndex = linkOwnIndex ? section.indexPath : undefined;
  if (section.documents.length > 0 || ownIndex) {
    lines.push(
      `## ${section.trail.map((label) => inlineMarkdown(label)).join(' / ')}`,
      '',
    );
    if (ownIndex) {
      lines.push(
        `- [${inlineMarkdown(section.trail.join(' / '))}: section index](${ownIndex}): Every document in this section, on its own.`,
      );
    }
    lines.push(
      ...section.documents.map((document) =>
        documentLine(document, indexClass),
      ),
    );
    lines.push('');
  }
  for (const child of section.children) {
    lines.push(...sectionLines(child, { linkOwnIndex: false, indexClass }));
  }
  return lines;
}

function header(title: string, summary: string | undefined, about: string) {
  return [
    `# ${inlineMarkdown(title)}`,
    '',
    ...(summary ? [`> ${inlineMarkdown(summary)}`, ''] : []),
    about,
    '',
  ];
}

function finish(lines: string[]): string {
  return `${lines.join('\n').trimEnd()}\n`;
}

/** The whole corpus, served at `/llms.txt` to every member. */
export function renderSiteIndex(
  site: AgentIndexSite,
  sections: readonly AgentIndexSection[],
): string {
  const indexClass = MEMBERS_CLASS;
  return finish([
    ...header(
      site.title,
      oneLine(site.description),
      'Every document on this site, in the order its navigation shows them. ' +
        "Each link is the document's Markdown version: its page address plus " +
        '`index.md`. A top-level section with an index of its own links to it ' +
        'first.',
    ),
    ...sections.flatMap((section) =>
      sectionLines(section, { linkOwnIndex: true, indexClass }),
    ),
  ]);
}

/**
 * One top-level folder, served at `<its page>llms.txt` to the readers of that
 * folder, whose class `indexClass` is.
 */
export function renderSectionIndex(
  site: AgentIndexSite,
  section: AgentIndexSection,
  indexClass: string = MEMBERS_CLASS,
): string {
  return finish([
    ...header(
      section.trail.join(' / '),
      `Every document in this section of ${site.title}.`,
      'The documents are in the order the navigation shows them. Each link is ' +
        "the document's Markdown version: its page address plus `index.md`. " +
        'The index of the whole site is [/llms.txt](/llms.txt).',
    ),
    ...sectionLines(section, { linkOwnIndex: false, indexClass }),
  ]);
}

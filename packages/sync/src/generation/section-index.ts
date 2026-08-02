/**
 * The page that gives a Drive folder an address.
 *
 * A folder is how readers refer to a division of the corpus, and Starlight
 * draws it as a sidebar label with nowhere to point. This page is the
 * destination: the folder's name and a listing of what is inside it, at the
 * folder's own slug. See docs/ADR/014-section-index-pages.md.
 *
 * The bytes are a pure function of the section's contents. There is no
 * synchronization timestamp in the frontmatter — a section page has no
 * provenance of its own to report, and a clock in the output would make an
 * unchanged corpus produce a diff on every run.
 */
import { PROJECT_LAYOUT } from '@ctcstack/ctcdocs-core';
import type { ListItem, Root } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import { stringify as stringifyYaml } from 'yaml';

import {
  computeGeneratedContentHash,
  type GeneratedAssetContent,
} from '../markdown/generated-document.js';

/** Shown by a folder that has nothing in it, so the page is never blank. */
const EMPTY_SECTION_NOTE = 'This section has no documents yet.';

/** A section page owns no assets; the hash still goes through one function. */
const NO_ASSETS: readonly GeneratedAssetContent[] = [];

const processor = unified().use(remarkGfm).use(remarkStringify, {
  bullet: '-',
  emphasis: '*',
  fences: true,
  listItemIndent: 'one',
  strong: '*',
});

export interface SectionIndexEntry {
  /** The name a reader sees, with any order prefix already removed. */
  label: string;
  /** Stable slug of the subfolder or document this entry points at. */
  slug: string;
  description?: string;
}

export interface SectionIndexInput {
  title: string;
  slug: string;
  /** Display labels of the folders above this one. */
  folderPath: string[];
  entries: readonly SectionIndexEntry[];
}

export function sectionIndexPath(googleFolderId: string): string {
  return `${PROJECT_LAYOUT.generatedDocumentsDirectory}/section-${googleFolderId}.md`;
}

/*
 * The listing is built as a syntax tree rather than assembled from strings:
 * labels and descriptions are Drive names, which may contain the characters
 * that open a Markdown link, and remark escapes them correctly by construction.
 */
function listItem(entry: SectionIndexEntry): ListItem {
  const description = entry.description?.replace(/\s+/gu, ' ').trim();
  return {
    type: 'listItem',
    spread: false,
    children: [
      {
        type: 'paragraph',
        children: [
          {
            type: 'link',
            url: `/${entry.slug}/`,
            children: [{ type: 'text', value: entry.label }],
          },
          ...(description
            ? [{ type: 'text' as const, value: ` — ${description}` }]
            : []),
        ],
      },
    ],
  };
}

function createSectionIndexBody(entries: readonly SectionIndexEntry[]): string {
  const tree: Root =
    entries.length === 0
      ? {
          type: 'root',
          children: [
            {
              type: 'paragraph',
              children: [{ type: 'text', value: EMPTY_SECTION_NOTE }],
            },
          ],
        }
      : {
          type: 'root',
          children: [
            {
              type: 'list',
              ordered: false,
              spread: false,
              children: entries.map(listItem),
            },
          ],
        };
  return processor.stringify(tree);
}

export function generateSectionIndexDocument(
  input: SectionIndexInput,
  markdownHeader: string,
): string {
  const body = createSectionIndexBody(input.entries).trimEnd();
  const frontmatter = stringifyYaml(
    {
      title: input.title,
      slug: input.slug,
      sourceType: 'section-index',
      contentHash: computeGeneratedContentHash(body, NO_ASSETS),
      folderPath: input.folderPath,
      pagefind: false,
    },
    {
      defaultStringType: 'QUOTE_DOUBLE',
      lineWidth: 0,
    },
  );

  return [
    '---',
    frontmatter.trimEnd(),
    '---',
    markdownHeader,
    '',
    body,
    '',
  ].join('\n');
}

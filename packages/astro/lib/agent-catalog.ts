/**
 * The documents the MCP server publishes for assistants (ADR-041).
 *
 * The build lists every document that has a Markdown projection and one
 * access class, with what the Worker writes to R2 beside it: its permanent
 * short ID, title, Markdown address, modified time and a hash of everything
 * that would change the stored object. The Worker compares those hashes with
 * the bucket and rewrites only what changed; the digest tells it, cheaply,
 * whether anything did. The object holds the projection without its front
 * matter (ADR-042), so the hash is of that text, and a sync that touches only
 * the front matter rewrites nothing. Each entry also names the folders the
 * document sits in and the source it is published from, which the tools
 * return with it and the bucket does not hold.
 */
import { createHash } from 'node:crypto';

import {
  markdownProjectionPath,
  type CorpusDocument,
  type CorpusFolder,
} from '@ctcstack/ctcdocs-core';
import {
  agentDocumentFormat,
  documentFormatOf,
} from '@ctcstack/ctcdocs-core/document-format';

import type { AgentDocument } from '../worker/access-map.js';
import { documentText } from '../worker/agents/document-text.js';
import type { BuiltPage, FileClass } from './access-map.js';

export interface AgentCatalog {
  readonly digest: string;
  readonly documents: readonly AgentDocument[];
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** The labels of a document's folders, outermost first, without the root. */
function folderPath(
  document: CorpusDocument,
  folders: ReadonlyMap<string, CorpusFolder>,
): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  let folder = document.parentId ? folders.get(document.parentId) : undefined;
  while (folder && folder.parentId !== null && !seen.has(folder.id)) {
    seen.add(folder.id);
    labels.unshift(folder.label);
    folder = folders.get(folder.parentId);
  }
  return labels;
}

export async function buildAgentCatalog({
  documents,
  folders,
  files,
  pages = [],
  readMarkdown,
}: {
  readonly documents: Iterable<CorpusDocument>;
  readonly folders: ReadonlyMap<string, CorpusFolder>;
  readonly files: ReadonlyMap<string, FileClass>;
  /** The built pages, which say what a document is published from. */
  readonly pages?: readonly BuiltPage[];
  /** The built projection at a site path; `undefined` when there is none. */
  readonly readMarkdown: (path: string) => Promise<string | undefined>;
}): Promise<AgentCatalog> {
  const pageAt = new Map(pages.map((page) => [page.path, page]));
  const listed: AgentDocument[] = [];
  for (const document of documents) {
    if (!document.shortId) {
      continue;
    }
    const markdown = markdownProjectionPath(document.slug);
    const fileClass = files.get(markdown);
    // A document held back before its first publication has no projection.
    if (typeof fileClass !== 'string') {
      continue;
    }
    const projection = await readMarkdown(markdown);
    const text =
      projection === undefined ? undefined : documentText(projection);
    if (text === undefined) {
      continue;
    }
    const title = document.title ?? document.slug;
    const page = pageAt.get(`/${document.slug}/`);
    const format = documentFormatOf(page?.source, page?.media) ?? 'google-doc';
    listed.push({
      id: document.shortId,
      title,
      markdown,
      modified: document.modified ?? null,
      path: folderPath(document, folders),
      source: document.source ?? null,
      format: agentDocumentFormat(format),
      ...(format === 'pdf' && page?.pdfPages !== undefined
        ? { pages: page.pdfPages }
        : {}),
      characters: text.length,
      hash: sha256(JSON.stringify([text, fileClass, title])),
    });
  }
  listed.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    digest: sha256(
      JSON.stringify(listed.map((document) => [document.id, document.hash])),
    ),
    documents: listed,
  };
}

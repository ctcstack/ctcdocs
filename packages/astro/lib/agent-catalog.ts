/**
 * The documents the MCP server publishes for assistants (ADR-041).
 *
 * The build lists every document that has a Markdown projection and one
 * access class, with what the Worker writes to R2 beside it: its permanent
 * short ID, title, Markdown address, modified time and a hash of everything
 * that would change the stored object. The Worker compares those hashes with
 * the bucket and rewrites only what changed; the digest tells it, cheaply,
 * whether anything did. Each entry also names the folders the document sits
 * in, which search returns with it (ADR-042) and which the bucket does not
 * hold.
 */
import { createHash } from 'node:crypto';

import {
  markdownProjectionPath,
  type CorpusDocument,
  type CorpusFolder,
} from '@ctcstack/ctcdocs-core';

import type { FileClass } from './access-map.js';

interface AgentDocument {
  /** The permanent short ID: the tool's `id` and the R2 object's name. */
  readonly id: string;
  readonly title: string;
  /** The Markdown projection's address, as the access map lists it. */
  readonly markdown: string;
  readonly modified: string | null;
  /** The folders from the corpus root to the document, as the site names them. */
  readonly path: readonly string[];
  /** SHA-256 of the projection, its class and its title. */
  readonly hash: string;
}

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
  readMarkdown,
}: {
  readonly documents: Iterable<CorpusDocument>;
  readonly folders: ReadonlyMap<string, CorpusFolder>;
  readonly files: ReadonlyMap<string, FileClass>;
  /** The built projection at a site path; `undefined` when there is none. */
  readonly readMarkdown: (path: string) => Promise<string | undefined>;
}): Promise<AgentCatalog> {
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
    const text = await readMarkdown(markdown);
    if (text === undefined) {
      continue;
    }
    const title = document.title ?? document.slug;
    listed.push({
      id: document.shortId,
      title,
      markdown,
      modified: document.modified ?? null,
      path: folderPath(document, folders),
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

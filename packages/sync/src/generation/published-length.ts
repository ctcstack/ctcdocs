/**
 * How long each page's Markdown version is: the text the MCP server's `fetch`
 * returns and cuts (ADR-043).
 *
 * The site serializes that text from the generated file, with the function
 * the core shares, and the Worker stores and cuts it as it is. Serializing it
 * here the same way, from the same file, counts exactly what an assistant is
 * given: its front matter, its title and its links as the site writes them,
 * not only the body the sync wrote.
 */
import { permanentLinkPath } from '@ctcstack/ctcdocs-core';
import {
  publishedFileUrl,
  serializePublishedMarkdown,
} from '@ctcstack/ctcdocs-core/published-markdown';

import type { SyncManifest } from '../manifest.js';
import { extractGeneratedFrontmatter } from '../markdown/generated-document.js';

interface ProjectionFacts {
  title: string;
  editUrl: string;
  googleFileId: string;
  googleModifiedTime: string;
  syncedAt: string;
  contentHash: string;
  pdf?: { file?: string };
}

function isProjectionFacts(value: unknown): value is ProjectionFacts {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const facts = value as Record<string, unknown>;
  return [
    'title',
    'editUrl',
    'googleFileId',
    'googleModifiedTime',
    'syncedAt',
    'contentHash',
  ].every((key) => typeof facts[key] === 'string');
}

/** What follows the front matter: what the site reads as the page's body. */
function bodyOf(content: string): string | undefined {
  const lines = content.split('\n');
  const closing = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
  return closing < 0 ? undefined : lines.slice(closing + 1).join('\n');
}

/**
 * The characters of each document's Markdown version, by Google file ID, for
 * the documents `manifest` lists and `output` holds. The links between pages
 * are those the site resolves: every document's, and every section page's.
 */
export function publishedLengths(
  output: ReadonlyMap<string, string | Uint8Array>,
  manifest: SyncManifest,
  markdownHeader: string,
): Map<string, number> {
  const documents = Object.values(manifest.documents);
  const stableSlugs = new Set(documents.map((record) => record.stableSlug));
  const permanentLinks = Object.fromEntries(
    [
      ...documents,
      ...Object.values(manifest.folders).filter(
        (folder) => folder.generatedMarkdownPath !== undefined,
      ),
    ].flatMap(({ shortId, stableSlug }) =>
      shortId === undefined || stableSlug === undefined
        ? []
        : [[permanentLinkPath(shortId), `/${stableSlug}/`]],
    ),
  );

  const lengths = new Map<string, number>();
  for (const record of documents) {
    const content = output.get(record.generatedMarkdownPath);
    if (typeof content !== 'string') {
      continue;
    }
    const facts = extractGeneratedFrontmatter(content);
    const body = bodyOf(content);
    if (!isProjectionFacts(facts) || body === undefined) {
      continue;
    }
    const text = serializePublishedMarkdown({
      title: facts.title,
      sourceUrl: facts.editUrl,
      ...(facts.pdf?.file
        ? { fileUrl: publishedFileUrl(facts.googleFileId, facts.pdf.file) }
        : {}),
      googleModifiedTime: facts.googleModifiedTime,
      syncedAt: facts.syncedAt,
      contentHash: facts.contentHash,
      body,
      ownershipHeader: markdownHeader,
      stableSlugs,
      permanentLinks,
    });
    lengths.set(record.googleFileId, text.length);
  }
  return lengths;
}

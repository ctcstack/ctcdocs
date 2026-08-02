import { describe, expect, it } from 'vitest';

import { createEmptyManifest, type SyncedDocumentRecord } from '../manifest.js';
import {
  aiDocsIndexSchema,
  createAiDocsIndex,
  serializeAiDocsIndex,
} from './ai-index.js';

const timestamp = '2026-01-01T00:00:00.000Z';

function record(id: string, slug: string): SyncedDocumentRecord {
  return {
    googleFileId: id,
    googleParentId: null,
    googleName: id,
    displayTitle: `Title ${id}`,
    googleModifiedTime: timestamp,
    sourceUrl: `https://docs.google.com/document/d/${id}/edit`,
    stableSlug: slug,
    generatedMarkdownPath: `src/content/docs/_generated/${id}.md`,
    generatedAssetsDirectory: `src/assets/generated/${id}`,
    contentHash: `sha256:${'0'.repeat(64)}`,
    outputHash: `sha256:${'1'.repeat(64)}`,
    lastSuccessfulSyncAt: timestamp,
    exportMode: 'markdown',
    warnings: [],
  };
}

describe('AI docs index', () => {
  it('sorts entries by stable slug and references repository Markdown paths', () => {
    const manifest = createEmptyManifest('drive', 'root', timestamp);
    manifest.documents.z = record('z', 'z-last');
    manifest.documents.a = record('a', 'a-first');
    const index = createAiDocsIndex(manifest, new Map([['a', ['Team']]]), 'en');

    expect(index.documents.map((entry) => entry.id)).toEqual(['a', 'z']);
    expect(index.documents[0]?.folderPath).toEqual(['Team']);
    expect(index.documents[1]?.folderPath).toEqual([]);
    expect(index.documents[0]?.markdownPath).toBe(
      'src/content/docs/_generated/a.md',
    );
    expect(
      aiDocsIndexSchema.parse(JSON.parse(serializeAiDocsIndex(index))),
    ).toEqual(index);
  });

  it('uses file ID as the deterministic tie-breaker for equal slugs', () => {
    const manifest = createEmptyManifest('drive', 'root', timestamp);
    manifest.documents.z = record('z', 'same');
    manifest.documents.a = record('a', 'same');
    expect(
      createAiDocsIndex(manifest, new Map(), 'en').documents.map(
        (entry) => entry.id,
      ),
    ).toEqual(['a', 'z']);
  });
});

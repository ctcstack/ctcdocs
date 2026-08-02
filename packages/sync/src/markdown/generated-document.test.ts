import { describe, expect, it } from 'vitest';

import {
  computeGeneratedContentHash,
  extractGeneratedDocumentBody,
  extractGeneratedFolderPath,
  generateMarkdownDocument,
} from './generated-document.js';
import { TEST_MARKDOWN_HEADER } from '../test-support/project-fixture.js';

const explicitContentHash = `sha256:${'a'.repeat(64)}`;

describe('generated Markdown document', () => {
  it('uses an explicit body-and-assets content hash and exposes the body', () => {
    const content = generateMarkdownDocument(
      {
        title: 'Fixture',
        description: 'Synthetic description.',
        slug: 'fixture',
        sourceUrl: 'https://docs.google.com/document/d/fixture/edit',
        googleFileId: 'fixture',
        googleModifiedTime: '2026-01-01T00:00:00.000Z',
        syncedAt: '2026-01-02T00:00:00.000Z',
        folderPath: ['Fixtures'],
        normalizedBody: 'Body.\n',
        contentHash: explicitContentHash,
      },
      TEST_MARKDOWN_HEADER,
    );

    expect(content).toContain(`"contentHash": "${explicitContentHash}"`);
    expect(extractGeneratedDocumentBody(content, TEST_MARKDOWN_HEADER)).toBe(
      'Body.\n',
    );
    expect(extractGeneratedFolderPath(content)).toEqual(['Fixtures']);
    expect(
      extractGeneratedDocumentBody('not generated', TEST_MARKDOWN_HEADER),
    ).toBeUndefined();
    expect(extractGeneratedFolderPath('not generated')).toBeUndefined();
  });

  it('hashes asset bytes in stable path order', () => {
    const first = computeGeneratedContentHash('Body.\n', [
      {
        repositoryPath: 'src/assets/generated/doc/image-002.png',
        bytes: Uint8Array.from([2]),
      },
      {
        repositoryPath: 'src/assets/generated/doc/image-001.png',
        bytes: Uint8Array.from([1]),
      },
    ]);
    const second = computeGeneratedContentHash('Body.\n', [
      {
        repositoryPath: 'src/assets/generated/doc/image-001.png',
        bytes: Uint8Array.from([1]),
      },
      {
        repositoryPath: 'src/assets/generated/doc/image-002.png',
        bytes: Uint8Array.from([2]),
      },
    ]);

    expect(first).toBe(second);
  });

  it('does not add content bytes to an empty generated body', () => {
    const content = generateMarkdownDocument(
      {
        title: 'Empty fixture',
        slug: 'empty-fixture',
        sourceUrl: 'https://docs.google.com/document/d/empty/edit',
        googleFileId: 'empty',
        googleModifiedTime: '2026-01-01T00:00:00.000Z',
        syncedAt: '2026-01-02T00:00:00.000Z',
        folderPath: [],
        normalizedBody: '',
        contentHash: computeGeneratedContentHash('', []),
      },
      TEST_MARKDOWN_HEADER,
    );

    expect(extractGeneratedDocumentBody(content, TEST_MARKDOWN_HEADER)).toBe(
      '',
    );
    expect(content.endsWith('\n\n')).toBe(true);
  });
});

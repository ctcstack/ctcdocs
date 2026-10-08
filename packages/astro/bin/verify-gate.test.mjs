import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { PROJECT_LAYOUT } from '@ctcstack/ctcdocs-core';
import { PUBLISHED_MARKDOWN_VERSION } from '@ctcstack/ctcdocs-core/published-markdown';

import { lengthNotesAgainst } from './verify-gate.mjs';

const note = {
  slug: 'guides/long-guide',
  note: 'document-over-agent-limit',
};

async function projectWith(documentLengths) {
  const root = await mkdtemp(join(tmpdir(), 'ctcdocs-gate-'));
  const path = join(root, PROJECT_LAYOUT.syncReportFile);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ documentLengths, notes: [note] }));
  return root;
}

test('the gate holds a deployment to the lengths its own Markdown measures', async () => {
  const root = await projectWith({
    largeDocumentCharacters: 40_000,
    fetchCharacters: 100_000,
    markdownVersion: PUBLISHED_MARKDOWN_VERSION,
  });
  try {
    const notes = await lengthNotesAgainst(root, 100_000);
    assert.deepEqual(
      [...(notes ?? [])],
      [['/guides/long-guide/index.md', 'document-over-agent-limit']],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('lengths measured on other Markdown, as before an upgrade, are not checked', async () => {
  for (const documentLengths of [
    // A report an earlier platform wrote, before the version was recorded.
    { largeDocumentCharacters: 40_000, fetchCharacters: 100_000 },
    {
      largeDocumentCharacters: 40_000,
      fetchCharacters: 100_000,
      markdownVersion: PUBLISHED_MARKDOWN_VERSION - 1,
    },
    // Another cut.
    {
      largeDocumentCharacters: 40_000,
      fetchCharacters: 50_000,
      markdownVersion: PUBLISHED_MARKDOWN_VERSION,
    },
  ]) {
    const root = await projectWith(documentLengths);
    try {
      assert.equal(await lengthNotesAgainst(root, 100_000), undefined);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

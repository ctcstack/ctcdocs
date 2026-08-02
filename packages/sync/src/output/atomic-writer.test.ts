import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  AtomicWriteError,
  writeGeneratedOutputAtomically,
} from './atomic-writer.js';

const temporaryDirectories: string[] = [];

function output(content: string): Map<string, string> {
  return new Map([
    ['src/content/docs/_generated/doc.md', `generated:${content}`],
    ['src/generated/sidebar.ts', `// generated sidebar:${content}`],
    ['data/sync-manifest.json', `manifest:${content}`],
    ['data/docs-index.json', `index:${content}`],
    ['data/latest-sync-report.json', `report:${content}`],
  ]);
}

async function createRepository(): Promise<string> {
  const repository = await mkdtemp(resolve(tmpdir(), 'kb-writer-'));
  temporaryDirectories.push(repository);
  await mkdir(resolve(repository, 'src/content/docs/_generated'), {
    recursive: true,
  });
  await writeFile(
    resolve(repository, 'src/content/docs/_generated/doc.md'),
    'generated:old',
  );
  await writeFile(resolve(repository, 'outside.txt'), 'preserve');
  return repository;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('atomic generated output writer', () => {
  it('replaces the complete generated output and leaves outside files intact', async () => {
    const repository = await createRepository();

    await expect(
      writeGeneratedOutputAtomically(repository, output('new')),
    ).resolves.toEqual({ changed: true });
    await expect(
      readFile(
        resolve(repository, 'src/content/docs/_generated/doc.md'),
        'utf8',
      ),
    ).resolves.toBe('generated:new');
    await expect(
      readFile(resolve(repository, 'outside.txt'), 'utf8'),
    ).resolves.toBe('preserve');
    await expect(
      writeGeneratedOutputAtomically(repository, output('new')),
    ).resolves.toEqual({ changed: false });
  });

  it('does not replace output in dry-run mode', async () => {
    const repository = await createRepository();

    await expect(
      writeGeneratedOutputAtomically(repository, output('new'), {
        dryRun: true,
      }),
    ).resolves.toEqual({ changed: true });
    await expect(
      readFile(
        resolve(repository, 'src/content/docs/_generated/doc.md'),
        'utf8',
      ),
    ).resolves.toBe('generated:old');
  });

  it('leaves the last known-good output untouched when validation fails', async () => {
    const repository = await createRepository();

    await expect(
      writeGeneratedOutputAtomically(repository, output('invalid'), {
        validate: () => {
          throw new AtomicWriteError('Synthetic validation failure.');
        },
      }),
    ).rejects.toThrow('Synthetic validation failure');
    await expect(
      readFile(
        resolve(repository, 'src/content/docs/_generated/doc.md'),
        'utf8',
      ),
    ).resolves.toBe('generated:old');
  });

  it('rejects outputs outside the generated allowlist', async () => {
    const repository = await createRepository();
    const invalidOutput = output('new');
    invalidOutput.set('README.md', 'not allowed');

    await expect(
      writeGeneratedOutputAtomically(repository, invalidOutput),
    ).rejects.toThrow('not allowed');
  });
});

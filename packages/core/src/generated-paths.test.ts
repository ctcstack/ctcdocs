import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  assertGeneratedPathAllowed,
  isGeneratedPathAllowed,
  normalizeRepositoryPath,
} from './generated-paths.js';
import {
  GENERATED_DIRECTORY_ALLOWLIST,
  GENERATED_FILE_ALLOWLIST,
} from './project-layout.js';

/** The fixture project is the platform's own consumer; its tree is prefixed. */
const FIXTURE_PROJECT_PREFIX = 'fixtures/project/';

describe('generated output path policy', () => {
  it('accepts allowlisted files and descendants of allowlisted directories', () => {
    for (const allowedPath of GENERATED_FILE_ALLOWLIST) {
      expect(isGeneratedPathAllowed(allowedPath)).toBe(true);
    }

    for (const allowedDirectory of GENERATED_DIRECTORY_ALLOWLIST) {
      expect(isGeneratedPathAllowed(allowedDirectory)).toBe(true);
      expect(isGeneratedPathAllowed(`${allowedDirectory}/nested/doc.md`)).toBe(
        true,
      );
    }
  });

  it('keeps every generated target of the fixture project outside Prettier checks', () => {
    const prettierIgnore = new Set(
      readFileSync(
        resolve(import.meta.dirname, '../../../.prettierignore'),
        'utf8',
      )
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#')),
    );

    for (const allowedDirectory of GENERATED_DIRECTORY_ALLOWLIST) {
      const ignored = `${FIXTURE_PROJECT_PREFIX}${allowedDirectory}/`;
      expect(prettierIgnore.has(ignored), ignored).toBe(true);
    }
    for (const allowedPath of GENERATED_FILE_ALLOWLIST) {
      // The whole data directory is ignored, so a file inside it is covered by
      // its parent rather than by its own entry.
      const parent = `${FIXTURE_PROJECT_PREFIX}${allowedPath.split('/')[0]}/`;
      expect(prettierIgnore.has(parent), allowedPath).toBe(true);
    }
  });

  it('rejects traversal, absolute paths, Windows separators, and near matches', () => {
    const rejected = [
      '',
      '.',
      '..',
      '../data/docs-index.json',
      '/data/docs-index.json',
      'data\\docs-index.json',
      'data/docs-index.json.bak',
      'src/generated-unsafe/file.ts',
      // The layout is repository-relative: a project directory prefix is not
      // part of it, and must not be accepted by accident.
      'fixtures/project/src/generated/sidebar.ts',
    ];

    for (const path of rejected) {
      expect(isGeneratedPathAllowed(path), path).toBe(false);
    }
  });

  it('normalizes safe dot segments without broadening the allowlist', () => {
    expect(normalizeRepositoryPath('data/./docs-index.json')).toBe(
      'data/docs-index.json',
    );
    expect(isGeneratedPathAllowed('data/./docs-index.json')).toBe(true);
  });

  it('never accepts a traversal prefix', () => {
    fc.assert(
      fc.property(fc.string(), (suffix) => {
        expect(isGeneratedPathAllowed(`../${suffix}`)).toBe(false);
      }),
    );
  });

  it('throws for output outside the allowlist', () => {
    expect(() => assertGeneratedPathAllowed('README.md')).toThrow(
      'Generated output path is not allowed',
    );
    expect(() =>
      assertGeneratedPathAllowed('data/sync-manifest.json'),
    ).not.toThrow();
  });
});

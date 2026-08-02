import { describe, expect, it } from 'vitest';

import {
  GeneratedDiffValidationError,
  validateGeneratedDiffPaths,
} from './generated-diff.js';

describe('validateGeneratedDiffPaths', () => {
  it('accepts, normalizes, deduplicates, and sorts generated paths', () => {
    expect(
      validateGeneratedDiffPaths([
        'data/sync-manifest.json',
        'src/content/docs/_generated/guide.md',
        'src/content/docs/_generated/./guide.md',
        'src/generated/sidebar.ts',
      ]),
    ).toEqual([
      'data/sync-manifest.json',
      'src/content/docs/_generated/guide.md',
      'src/generated/sidebar.ts',
    ]);
  });

  it('rejects any path outside the generated allowlist', () => {
    expect(() =>
      validateGeneratedDiffPaths([
        'src/content/docs/_generated/guide.md',
        'astro.config.mjs',
        '.github/workflows/deploy.yml',
      ]),
    ).toThrowError(
      new GeneratedDiffValidationError([
        '.github/workflows/deploy.yml',
        'astro.config.mjs',
      ]),
    );
  });

  it('rejects traversal, absolute, and backslash paths', () => {
    expect(() =>
      validateGeneratedDiffPaths([
        '../data/sync-manifest.json',
        '/data/sync-manifest.json',
        'data\\sync-manifest.json',
      ]),
    ).toThrow(GeneratedDiffValidationError);
  });
});

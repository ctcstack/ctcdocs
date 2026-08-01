import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PROJECT_LAYOUT } from './project-layout.js';
import { findProjectRoot, ProjectRootError } from './project-root.js';

/** macOS temporary directories are symlinked; comparisons need the real path. */
function makeProjectRoot(): string {
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), 'ctcdocs-root-')));
  writeFileSync(resolve(root, PROJECT_LAYOUT.configurationFile), '{}', 'utf8');
  return root;
}

describe('findProjectRoot', () => {
  it('returns the directory holding the configuration', () => {
    const root = makeProjectRoot();

    expect(findProjectRoot(root)).toBe(root);
  });

  it('walks up from a directory deep inside the project', () => {
    const root = makeProjectRoot();
    const nested = resolve(root, PROJECT_LAYOUT.generatedAssetsDirectory);
    mkdirSync(nested, { recursive: true });

    expect(findProjectRoot(nested)).toBe(root);
  });

  it('fails with the directory it searched from when there is no project', () => {
    const orphan = realpathSync(
      mkdtempSync(resolve(tmpdir(), 'ctcdocs-orphan-')),
    );

    // The temporary directory has ancestors, so the walk ends at the file
    // system root rather than at the directory it started in.
    expect(() => findProjectRoot(orphan)).toThrow(ProjectRootError);
  });
});

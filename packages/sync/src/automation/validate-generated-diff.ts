import { execFileSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  GeneratedDiffValidationError,
  validateGeneratedDiffPaths,
} from './generated-diff.js';

function readNullSeparatedGitOutput(
  repositoryRoot: string,
  arguments_: readonly string[],
): string[] {
  const output = execFileSync('git', arguments_, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  return output.split('\0').filter(Boolean);
}

function listChangedPaths(repositoryRoot: string): readonly string[] {
  return [
    ...readNullSeparatedGitOutput(repositoryRoot, [
      'diff',
      '--name-only',
      '--no-renames',
      '--relative',
      '-z',
      'HEAD',
      '--',
    ]),
    ...readNullSeparatedGitOutput(repositoryRoot, [
      'ls-files',
      '--others',
      '--exclude-standard',
      '-z',
    ]),
  ];
}

function assertNoGeneratedSymlinks(
  repositoryRoot: string,
  paths: readonly string[],
): void {
  const symlinks: string[] = [];
  for (const path of paths) {
    try {
      if (lstatSync(resolve(repositoryRoot, path)).isSymbolicLink()) {
        symlinks.push(path);
      }
    } catch (error: unknown) {
      if (!(
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      )) {
        throw error;
      }
    }
  }

  if (symlinks.length > 0) {
    throw new GeneratedDiffValidationError(symlinks);
  }
}

/**
 * Fails when a sync run touched anything outside the generated-path allowlist,
 * which is what stands between an automated commit and the rest of a project.
 * The sync workflow runs it before it commits.
 */
export function validateGeneratedDiff(repositoryRoot: string): void {
  const paths = validateGeneratedDiffPaths(listChangedPaths(repositoryRoot));
  assertNoGeneratedSymlinks(repositoryRoot, paths);
  console.log(`Generated diff validation passed (${paths.length} paths).`);
}

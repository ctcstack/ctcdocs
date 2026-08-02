import { execFileSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { GeneratedDiffValidationError, validateGeneratedDiffPaths, } from './generated-diff.js';
function readNullSeparatedGitOutput(repositoryRoot, arguments_) {
    const output = execFileSync('git', arguments_, {
        cwd: repositoryRoot,
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'inherit'],
    });
    return output.split('\0').filter(Boolean);
}
function listChangedPaths(repositoryRoot) {
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
function assertNoGeneratedSymlinks(repositoryRoot, paths) {
    const symlinks = [];
    for (const path of paths) {
        try {
            if (lstatSync(resolve(repositoryRoot, path)).isSymbolicLink()) {
                symlinks.push(path);
            }
        }
        catch (error) {
            if (!(error instanceof Error &&
                'code' in error &&
                error.code === 'ENOENT')) {
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
export function validateGeneratedDiff(repositoryRoot) {
    const paths = validateGeneratedDiffPaths(listChangedPaths(repositoryRoot));
    assertNoGeneratedSymlinks(repositoryRoot, paths);
    console.log(`Generated diff validation passed (${paths.length} paths).`);
}

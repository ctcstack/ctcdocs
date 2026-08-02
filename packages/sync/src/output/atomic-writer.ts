import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';

import {
  assertGeneratedPathAllowed,
  GENERATED_DIRECTORY_ALLOWLIST,
  GENERATED_FILE_ALLOWLIST,
} from '@ctcstack/ctcdocs-core';

const GENERATED_TARGETS = [
  ...GENERATED_DIRECTORY_ALLOWLIST,
  ...GENERATED_FILE_ALLOWLIST,
] as const;

export interface AtomicWriteOptions {
  dryRun?: boolean;
  validate?: (stagedRepositoryRoot: string) => Promise<void>;
}

export interface AtomicWriteResult {
  changed: boolean;
}

export class AtomicWriteError extends Error {
  override readonly name = 'AtomicWriteError';
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function collectTreeEntries(
  root: string,
  current = root,
): Promise<Array<{ path: string; bytes: Uint8Array }>> {
  if (!(await pathExists(current))) {
    return [];
  }
  const currentStat = await stat(current);
  if (currentStat.isFile()) {
    return [
      { path: relative(root, current) || '.', bytes: await readFile(current) },
    ];
  }
  if (!currentStat.isDirectory()) {
    throw new AtomicWriteError(
      'Generated output contains an unsupported entry.',
    );
  }

  const entries = await readdir(current, { withFileTypes: true });
  const nested: Array<{ path: string; bytes: Uint8Array }> = [];
  for (const entry of entries.sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  )) {
    if (entry.isSymbolicLink()) {
      throw new AtomicWriteError('Generated output must not contain symlinks.');
    }
    nested.push(
      ...(await collectTreeEntries(root, resolve(current, entry.name))),
    );
  }
  return nested;
}

async function targetDigest(path: string): Promise<string> {
  const hash = createHash('sha256');
  for (const entry of await collectTreeEntries(path)) {
    hash.update(entry.path);
    hash.update('\0');
    hash.update(entry.bytes);
    hash.update('\0');
  }
  return hash.digest('hex');
}

function assertPathInside(root: string, candidate: string): void {
  const relativePath = relative(root, candidate);
  if (
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    relativePath.startsWith(sep)
  ) {
    throw new AtomicWriteError('Generated output escaped the staging root.');
  }
}

async function createStagedOutput(
  repositoryRoot: string,
  output: ReadonlyMap<string, string | Uint8Array>,
): Promise<{ temporaryRoot: string; stagedRoot: string }> {
  const temporaryParent = resolve(repositoryRoot, '.tmp');
  await mkdir(temporaryParent, { recursive: true });
  const temporaryRoot = await mkdtemp(resolve(temporaryParent, 'kb-sync-'));
  const stagedRoot = resolve(temporaryRoot, 'staged');
  try {
    await mkdir(stagedRoot, { recursive: true });

    for (const directory of GENERATED_DIRECTORY_ALLOWLIST) {
      await mkdir(resolve(stagedRoot, directory), { recursive: true });
    }

    for (const [repositoryPath, content] of output) {
      assertGeneratedPathAllowed(repositoryPath);
      const target = resolve(stagedRoot, repositoryPath);
      assertPathInside(stagedRoot, target);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    }

    for (const file of GENERATED_FILE_ALLOWLIST) {
      if (!output.has(file)) {
        throw new AtomicWriteError(`Generated output is missing ${file}.`);
      }
    }
  } catch (error: unknown) {
    await rm(temporaryRoot, { force: true, recursive: true });
    throw error;
  }

  return { temporaryRoot, stagedRoot };
}

async function generatedOutputChanged(
  repositoryRoot: string,
  stagedRoot: string,
): Promise<boolean> {
  for (const target of GENERATED_TARGETS) {
    if (
      (await targetDigest(resolve(repositoryRoot, target))) !==
      (await targetDigest(resolve(stagedRoot, target)))
    ) {
      return true;
    }
  }
  return false;
}

export async function writeGeneratedOutputAtomically(
  repositoryRoot: string,
  output: ReadonlyMap<string, string | Uint8Array>,
  options: AtomicWriteOptions = {},
): Promise<AtomicWriteResult> {
  const { temporaryRoot, stagedRoot } = await createStagedOutput(
    repositoryRoot,
    output,
  );
  const backupRoot = resolve(temporaryRoot, 'backup');

  try {
    await options.validate?.(stagedRoot);
    const changed = await generatedOutputChanged(repositoryRoot, stagedRoot);
    if (!changed || options.dryRun) {
      return { changed };
    }

    await mkdir(backupRoot, { recursive: true });
    const replacedTargets: Array<{ target: string; backup?: string }> = [];

    try {
      for (const repositoryPath of GENERATED_TARGETS) {
        const target = resolve(repositoryRoot, repositoryPath);
        const staged = resolve(stagedRoot, repositoryPath);
        const backup = resolve(backupRoot, repositoryPath);
        await mkdir(dirname(target), { recursive: true });
        await mkdir(dirname(backup), { recursive: true });

        const hadExistingTarget = await pathExists(target);
        if (hadExistingTarget) {
          await rename(target, backup);
        }
        replacedTargets.push({
          target,
          ...(hadExistingTarget ? { backup } : {}),
        });
        await rename(staged, target);
      }
    } catch (error: unknown) {
      for (const replaced of replacedTargets.reverse()) {
        await rm(replaced.target, { force: true, recursive: true });
        if (replaced.backup && (await pathExists(replaced.backup))) {
          await rename(replaced.backup, replaced.target);
        }
      }
      throw new AtomicWriteError(
        'Generated output replacement failed and was rolled back.',
        { cause: error },
      );
    }

    return { changed: true };
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

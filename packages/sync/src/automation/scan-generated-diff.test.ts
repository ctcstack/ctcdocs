import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { promisify } from 'node:util';

import { PROJECT_LAYOUT } from '@ctcstack/ctcdocs-core';
import { afterEach, describe, expect, it } from 'vitest';

import { createEmptyManifest } from '../manifest.js';
import {
  scanGeneratedDiff,
  type SecretScanner,
} from './scan-generated-diff.js';
import {
  GITLEAKS_FINDINGS_EXIT_CODE,
  SecretFindingsError,
  SecretScanError,
} from './secret-scan.js';

const runCommand = promisify(execFile);
const temporaryDirectories: string[] = [];

/* Stands in for document text; nothing the command reports may contain it. */
const DOCUMENT_TEXT = 'SYNTHETIC-DOCUMENT-TEXT';
const GITLEAKS_CONFIGURATION = '[extend]\nuseDefault = true\n';
const SETUP = 'src/content/docs/_generated/guide/setup.md';
const ADDED = 'src/content/docs/_generated/added.md';

async function git(root: string, ...arguments_: string[]): Promise<void> {
  await runCommand('git', arguments_, { cwd: root });
}

async function write(root: string, path: string, content: string) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
}

/**
 * A project whose last commit is the previous sync, and whose working tree is
 * what the current run wrote: one document changed, one added, one removed,
 * one untouched.
 */
async function createProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'secret-scan-'));
  temporaryDirectories.push(root);
  await git(root, 'init', '--quiet');
  await write(
    root,
    PROJECT_LAYOUT.gitleaksConfigurationFile,
    GITLEAKS_CONFIGURATION,
  );
  await write(root, SETUP, '# Setup\n');
  await write(root, 'src/content/docs/_generated/unchanged.md', '# Same\n');
  await write(root, 'src/content/docs/_generated/removed.md', '# Gone\n');
  await git(root, 'add', '--all');
  await git(
    root,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.test',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--quiet',
    '--message',
    'previous sync',
  );

  await write(root, SETUP, '# Setup\n\nChanged.\n');
  await write(root, ADDED, '# Added\n');
  await rm(join(root, 'src/content/docs/_generated/removed.md'));
  return root;
}

async function writeManifest(root: string): Promise<void> {
  const timestamp = '2026-01-01T00:00:00.000Z';
  const manifest = createEmptyManifest('drive-id', 'root-id', timestamp);
  manifest.documents['doc-setup'] = {
    googleFileId: 'doc-setup',
    googleParentId: 'root-id',
    googleName: 'Setup',
    displayTitle: 'Setup',
    googleModifiedTime: timestamp,
    sourceUrl: 'https://docs.google.com/document/d/doc-setup/edit',
    stableSlug: 'guide/setup',
    generatedMarkdownPath: SETUP,
    generatedAssetsDirectory: 'src/assets/generated/doc-setup',
    contentHash: `sha256:${'0'.repeat(64)}`,
    outputHash: `sha256:${'1'.repeat(64)}`,
    lastSuccessfulSyncAt: timestamp,
    exportMode: 'markdown',
    warnings: [],
  };
  await write(root, PROJECT_LAYOUT.manifestFile, JSON.stringify(manifest));
}

function finding(path: string, line: number) {
  return {
    RuleID: 'generic-api-key',
    File: path,
    StartLine: line,
    Match: `${DOCUMENT_TEXT}: "REDACTED"`,
    Secret: 'REDACTED',
    Fingerprint: `${path}:generic-api-key:${line}`,
  };
}

interface ScannerCall {
  binary: string;
  arguments_: readonly string[];
  workingDirectory: string;
  files: string[];
  contents: Record<string, string>;
}

/** A stand-in for gitleaks that records what it was shown and answers as told. */
function fakeScanner(
  status: number,
  report?: unknown,
): { scanner: SecretScanner; calls: ScannerCall[] } {
  const calls: ScannerCall[] = [];
  const scanner: SecretScanner = async (
    binary,
    arguments_,
    workingDirectory,
  ) => {
    const entries = await readdir(workingDirectory, {
      recursive: true,
      withFileTypes: true,
    });
    const files = entries
      .filter((entry) => entry.isFile())
      .map((entry) =>
        relative(workingDirectory, join(entry.parentPath, entry.name)),
      )
      .sort();
    const contents: Record<string, string> = {};
    for (const file of files) {
      contents[file] = await readFile(join(workingDirectory, file), 'utf8');
    }
    calls.push({ binary, arguments_, workingDirectory, files, contents });

    const reportFile = arguments_[arguments_.indexOf('--report-path') + 1];
    if (report !== undefined && reportFile !== undefined) {
      await writeFile(
        reportFile,
        typeof report === 'string' ? report : JSON.stringify(report),
      );
    }
    return status;
  };
  return { scanner, calls };
}

function onlyCall(calls: readonly ScannerCall[]): ScannerCall {
  const [call, ...rest] = calls;
  if (call === undefined || rest.length > 0) {
    throw new Error(`Expected one scanner run, saw ${calls.length}.`);
  }
  return call;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('the generated diff secret scan', () => {
  it('scans a snapshot of exactly the files the run added or changed', async () => {
    const root = await createProject();
    const { scanner, calls } = fakeScanner(0, []);

    await expect(scanGeneratedDiff(root, {}, scanner)).resolves.toBe(2);

    const call = onlyCall(calls);
    expect(call.binary).toBe('gitleaks');
    expect(call.files).toEqual([ADDED, SETUP]);
    expect(call.contents[SETUP]).toBe('# Setup\n\nChanged.\n');
    expect(call.arguments_).toContain(
      join(root, PROJECT_LAYOUT.gitleaksConfigurationFile),
    );
    expect(existsSync(call.workingDirectory)).toBe(false);
  });

  it('runs the scanner the workflow installed', async () => {
    const root = await createProject();
    const { scanner, calls } = fakeScanner(0, []);

    await scanGeneratedDiff(
      root,
      { CTCDOCS_GITLEAKS_BINARY: '/runner/temp/gitleaks' },
      scanner,
    );

    expect(onlyCall(calls).binary).toBe('/runner/temp/gitleaks');
  });

  it('reports each finding by rule, path, line and Google file, never by value', async () => {
    const root = await createProject();
    await writeManifest(root);
    const { scanner, calls } = fakeScanner(GITLEAKS_FINDINGS_EXIT_CODE, [
      finding(ADDED, 1),
      finding(SETUP, 3),
    ]);

    const error = await scanGeneratedDiff(root, {}, scanner).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(SecretFindingsError);
    expect((error as SecretFindingsError).findings).toEqual([
      `rule=generic-api-key path=${ADDED} line=1`,
      `rule=generic-api-key path=${SETUP} line=3 fileId=doc-setup`,
    ]);
    expect(JSON.stringify(error)).not.toContain(DOCUMENT_TEXT);
    expect((error as Error).message).not.toContain(DOCUMENT_TEXT);
    expect(existsSync(onlyCall(calls).workingDirectory)).toBe(false);
  });

  it('fails on findings even when the exit status did not announce them', async () => {
    const root = await createProject();
    const { scanner } = fakeScanner(0, [finding(SETUP, 3)]);

    await expect(scanGeneratedDiff(root, {}, scanner)).rejects.toBeInstanceOf(
      SecretFindingsError,
    );
  });

  it.each([
    [
      'announces findings its report does not list',
      GITLEAKS_FINDINGS_EXIT_CODE,
      [],
    ],
    ['exits with an error of its own', 1, undefined],
    ['writes no report', 0, undefined],
    ['writes a report that cannot be read', 0, 'not json'],
  ])('fails when the scanner %s', async (_case, status, report) => {
    const root = await createProject();
    const { scanner } = fakeScanner(status, report);

    await expect(scanGeneratedDiff(root, {}, scanner)).rejects.toBeInstanceOf(
      SecretScanError,
    );
  });

  it('passes without running the scanner when nothing was added or changed', async () => {
    const root = await createProject();
    await git(root, 'checkout', '--quiet', '--', '.');
    await rm(join(root, ADDED));
    const { scanner, calls } = fakeScanner(0, []);

    await expect(scanGeneratedDiff(root, {}, scanner)).resolves.toBe(0);
    expect(calls).toEqual([]);
  });

  it('refuses to scan without the project configuration', async () => {
    const root = await createProject();
    await rm(join(root, PROJECT_LAYOUT.gitleaksConfigurationFile));
    const { scanner, calls } = fakeScanner(0, []);

    await expect(scanGeneratedDiff(root, {}, scanner)).rejects.toThrow(
      'secret scanning has no configuration',
    );
    expect(calls).toEqual([]);
  });

  it('refuses a changed generated file the configuration exempts', async () => {
    const root = await createProject();
    await write(
      root,
      PROJECT_LAYOUT.gitleaksConfigurationFile,
      `${GITLEAKS_CONFIGURATION}\n[[allowlists]]\npaths = ['''(^|/)dist/''']\n`,
    );
    await write(root, 'src/content/docs/_generated/dist/notes.md', '# Notes\n');
    const { scanner, calls } = fakeScanner(0, []);

    await expect(scanGeneratedDiff(root, {}, scanner)).rejects.toThrow(
      'exempts generated files from secret scanning: src/content/docs/_generated/dist/notes.md',
    );
    expect(calls).toEqual([]);
  });

  it('refuses an exemption it cannot interpret', async () => {
    const root = await createProject();
    await write(
      root,
      PROJECT_LAYOUT.gitleaksConfigurationFile,
      `${GITLEAKS_CONFIGURATION}\n[[allowlists]]\npaths = ['''[unclosed''']\n`,
    );
    const { scanner } = fakeScanner(0, []);

    await expect(scanGeneratedDiff(root, {}, scanner)).rejects.toThrow(
      'cannot be interpreted',
    );
  });

  it('refuses a changed path that is not a regular file', async () => {
    const root = await createProject();
    await symlink(
      '../../../../.gitleaks.toml',
      join(root, 'src/content/docs/_generated/link.md'),
    );
    const { scanner } = fakeScanner(0, []);

    await expect(scanGeneratedDiff(root, {}, scanner)).rejects.toThrow(
      'not a regular file',
    );
  });

  it('reports a scanner that cannot be started', async () => {
    const root = await createProject();

    await expect(
      scanGeneratedDiff(root, {
        CTCDOCS_GITLEAKS_BINARY: join(root, 'no-such-scanner'),
      }),
    ).rejects.toThrow('could not be started');
  });

  it('reports a scanner that fails without writing a result', async () => {
    const root = await createProject();

    // Node cannot run a script called `dir`, and exits with status 1.
    await expect(
      scanGeneratedDiff(root, { CTCDOCS_GITLEAKS_BINARY: process.execPath }),
    ).rejects.toThrow('exited with status 1');
  });
});

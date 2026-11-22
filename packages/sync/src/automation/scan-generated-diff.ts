import { spawn } from 'node:child_process';
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';

import {
  normalizeRepositoryPath,
  PROJECT_LAYOUT,
} from '@ctcstack/ctcdocs-core';

import { gitleaksExemptPatterns } from '../gitleaks-configuration.js';
import { plainTextView } from './plain-text-view.js';
import {
  createGoogleFileIdResolver,
  describeSecretFinding,
  GITLEAKS_FINDINGS_EXIT_CODE,
  gitleaksArguments,
  parseGitleaksReport,
  type SecretFinding,
  SecretFindingsError,
  SecretScanError,
} from './secret-scan.js';
import { listChangedPaths } from './validate-generated-diff.js';

/** Runs the scanner and resolves with its exit status. */
export type SecretScanner = (
  binary: string,
  arguments_: readonly string[],
  workingDirectory: string,
) => Promise<number>;

/*
 * The scanner's own output is discarded rather than relayed. Its report is the
 * result, and what it prints about a failure is not something this command
 * can vouch for — the same reason a Google error message is never printed.
 */
const spawnScanner: SecretScanner = (binary, arguments_, workingDirectory) =>
  new Promise((resolveStatus, reject) => {
    const child = spawn(binary, arguments_, {
      cwd: workingDirectory,
      stdio: 'ignore',
    });
    child.once('error', () => {
      reject(
        new SecretScanError(
          `The secret scanner could not be started: ${binary}`,
        ),
      );
    });
    child.once('close', (code, signal) => {
      if (code === null) {
        reject(
          new SecretScanError(`The secret scanner was stopped by ${signal}.`),
        );
        return;
      }
      resolveStatus(code);
    });
  });

async function readConfiguration(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new SecretScanError(
        `${PROJECT_LAYOUT.gitleaksConfigurationFile} is missing; secret scanning has no configuration.`,
      );
    }
    throw error;
  }
}

/**
 * The changed paths that still exist, which are the ones a commit adds or
 * changes. A deleted file has nothing left to scan. Anything that is not a
 * regular file cannot be scanned as one, and is refused rather than skipped.
 */
async function listScannableFiles(repositoryRoot: string): Promise<string[]> {
  const files: string[] = [];
  for (const changedPath of new Set(listChangedPaths(repositoryRoot))) {
    const path = normalizeRepositoryPath(changedPath);
    if (path === undefined) {
      throw new SecretScanError(
        `The generated diff has a path that cannot be scanned: ${changedPath}`,
      );
    }
    let isFile: boolean;
    try {
      isFile = (await lstat(resolve(repositoryRoot, path))).isFile();
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        continue;
      }
      throw error;
    }
    if (!isFile) {
      throw new SecretScanError(
        `The generated diff has a path that is not a regular file: ${path}`,
      );
    }
    files.push(path);
  }

  return files.sort();
}

/*
 * An exemption the scanner honors silently. `validate` refuses one that covers
 * a tracked file, but only after the file is committed; a generated folder
 * whose slug happens to match an unanchored pattern such as `(^|/)dist/` would
 * reach the site first.
 */
function assertNothingExempt(
  files: readonly string[],
  configuration: string,
): void {
  const patterns = gitleaksExemptPatterns(configuration).map((pattern) => {
    try {
      return new RegExp(pattern);
    } catch {
      throw new SecretScanError(
        `${PROJECT_LAYOUT.gitleaksConfigurationFile} exempts a path pattern that cannot be interpreted: ${pattern}`,
      );
    }
  });
  const exempt = files.filter((path) =>
    patterns.some((pattern) => pattern.test(path)),
  );
  if (exempt.length > 0) {
    throw new SecretScanError(
      `${PROJECT_LAYOUT.gitleaksConfigurationFile} exempts generated files from secret scanning: ${exempt.join(', ')}`,
    );
  }
}

async function loadGoogleFileIdResolver(
  repositoryRoot: string,
): Promise<(path: string) => string | undefined> {
  try {
    return createGoogleFileIdResolver(
      JSON.parse(
        await readFile(
          resolve(repositoryRoot, PROJECT_LAYOUT.manifestFile),
          'utf8',
        ),
      ),
    );
  } catch {
    // The file ID is a convenience; a finding is reported without one.
    return () => undefined;
  }
}

/** Generated Markdown, the files that get a plain-text view as well. */
const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx']);

/**
 * Runs the scanner over one snapshot and returns what it found. A run that did
 * not complete, or whose report contradicts its exit status, rejects with
 * `SecretScanError`.
 */
async function scanSnapshot(
  snapshot: string,
  reportFile: string,
  configurationFile: string,
  repositoryRoot: string,
  environment: Record<string, string | undefined>,
  scanner: SecretScanner,
): Promise<SecretFinding[]> {
  const status = await scanner(
    environment.CTCDOCS_GITLEAKS_BINARY || 'gitleaks',
    gitleaksArguments({
      configurationFile,
      ignoreDirectory: repositoryRoot,
      reportFile,
    }),
    snapshot,
  );
  if (status !== 0 && status !== GITLEAKS_FINDINGS_EXIT_CODE) {
    throw new SecretScanError(
      `The secret scanner exited with status ${status} without completing the scan.`,
    );
  }

  let report: string;
  try {
    report = await readFile(reportFile, 'utf8');
  } catch {
    throw new SecretScanError('The secret scanner wrote no report.');
  }
  const findings = parseGitleaksReport(report);
  if (findings.length === 0 && status !== 0) {
    throw new SecretScanError(
      'The secret scanner reported findings its report does not list.',
    );
  }
  return findings;
}

const findingKey = (finding: SecretFinding) =>
  `${finding.path}\0${finding.ruleId}\0${finding.line}`;

/**
 * Scans every file a sync run changed for secrets, before the run commits it.
 *
 * The commit the sync pushes is made with the workflow's own token, which
 * triggers no other workflow, so the project's CI never scans it. The files are
 * copied to a snapshot under their repository paths and scanned there with the
 * project's own `.gitleaks.toml` and `.gitleaksignore` — the configuration the
 * CI gate reads, so an allowlist entry means the same thing to both.
 *
 * Generated Markdown is scanned a second time as plain text (see
 * `plainTextView`), from a second snapshot with the same paths and line
 * numbers, so a value hidden from the scanner's rules by Markdown syntax is
 * found and an ignore entry covers both views alike. A finding only the plain
 * text shows is reported with `view=plain-text`.
 *
 * Resolves with the number of files scanned; a finding rejects with
 * `SecretFindingsError`, and a scan that could not be trusted with
 * `SecretScanError`. The snapshots and the reports are removed either way.
 */
export async function scanGeneratedDiff(
  repositoryRoot: string,
  environment: Record<string, string | undefined> = process.env,
  scanner: SecretScanner = spawnScanner,
): Promise<number> {
  const configurationFile = resolve(
    repositoryRoot,
    PROJECT_LAYOUT.gitleaksConfigurationFile,
  );
  const configuration = await readConfiguration(configurationFile);
  const files = await listScannableFiles(repositoryRoot);
  assertNothingExempt(files, configuration);
  if (files.length === 0) {
    console.log('Generated diff secret scan passed (0 files).');
    return 0;
  }

  const workspace = await mkdtemp(join(tmpdir(), 'ctcdocs-secret-scan-'));
  try {
    const snapshot = join(workspace, 'snapshot');
    const plainSnapshot = join(workspace, 'plain-text');
    let markdownFiles = 0;
    for (const path of files) {
      const target = join(snapshot, path);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(resolve(repositoryRoot, path), target);
      if (MARKDOWN_EXTENSIONS.has(extname(path).toLowerCase())) {
        const plainTarget = join(plainSnapshot, path);
        await mkdir(dirname(plainTarget), { recursive: true });
        await writeFile(
          plainTarget,
          plainTextView(await readFile(target, 'utf8')),
        );
        markdownFiles += 1;
      }
    }

    const findings = await scanSnapshot(
      snapshot,
      join(workspace, 'report.json'),
      configurationFile,
      repositoryRoot,
      environment,
      scanner,
    );
    const plainFindings =
      markdownFiles === 0
        ? []
        : await scanSnapshot(
            plainSnapshot,
            join(workspace, 'plain-text-report.json'),
            configurationFile,
            repositoryRoot,
            environment,
            scanner,
          );

    // One line can match twice in the plain text, once in a URL and once in
    // its parameter; a place is reported once.
    const seen = new Set(findings.map(findingKey));
    const plainOnly = plainFindings.filter((finding) => {
      const key = findingKey(finding);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
    if (findings.length === 0 && plainOnly.length === 0) {
      console.log(`Generated diff secret scan passed (${files.length} files).`);
      return files.length;
    }

    const googleFileId = await loadGoogleFileIdResolver(repositoryRoot);
    throw new SecretFindingsError([
      ...findings.map((finding) =>
        describeSecretFinding(finding, googleFileId(finding.path)),
      ),
      ...plainOnly.map(
        (finding) =>
          `${describeSecretFinding(finding, googleFileId(finding.path))} view=plain-text`,
      ),
    ]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

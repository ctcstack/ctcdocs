import { normalizeRepositoryPath } from '@ctcstack/ctcdocs-core';
import { z } from 'zod';

import { syncManifestSchema } from '../manifest.js';

/**
 * Reading what the secret scanner found in a sync run's generated diff, and
 * saying so without repeating it.
 *
 * gitleaks runs with `--redact`, so its report holds no secret. It still holds
 * the text around one — `Match` is a stretch of a document — so only the rule,
 * the file and the line are read from it, and those are all a log ever sees.
 */

/**
 * The status gitleaks is told to exit with when it finds something. It exits
 * with 1 both for a finding and for a failure of its own by default, and the
 * two must not be confused: a scan that did not run has not passed.
 */
export const GITLEAKS_FINDINGS_EXIT_CODE = 99;

export interface SecretFinding {
  readonly ruleId: string;
  readonly path: string;
  readonly line: number;
}

/** The scan could not be run, or its result could not be trusted. */
export class SecretScanError extends Error {
  override readonly name = 'SecretScanError';
}

/** The scan ran and found something. Every entry is safe to log. */
export class SecretFindingsError extends Error {
  override readonly name = 'SecretFindingsError';

  constructor(readonly findings: readonly string[]) {
    super(`The generated diff has ${findings.length} secret scan findings.`);
  }
}

/*
 * A value that is printed on a line of its own must not be able to start
 * another one, which is how a workflow command would be smuggled into the log.
 */
const printable = z
  .string()
  .min(1)
  .regex(/^[^\p{Cc}]+$/u);

/*
 * Unknown keys are dropped by the parse, which is the point: `Match`, `Secret`
 * and the commit metadata never reach the objects this module hands on.
 */
const gitleaksReportSchema = z.array(
  z.object({
    RuleID: printable,
    File: printable,
    StartLine: z.number().int().nonnegative(),
  }),
);

function compareFindings(left: SecretFinding, right: SecretFinding): number {
  if (left.path !== right.path) {
    return left.path < right.path ? -1 : 1;
  }
  if (left.line !== right.line) {
    return left.line - right.line;
  }
  return left.ruleId < right.ruleId ? -1 : left.ruleId > right.ruleId ? 1 : 0;
}

export function parseGitleaksReport(content: string): SecretFinding[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new SecretScanError(
      'The secret scanner wrote a report that is not JSON.',
    );
  }

  // The parse error is not attached: it would describe the values it rejected.
  const report = gitleaksReportSchema.safeParse(parsed);
  if (!report.success) {
    throw new SecretScanError(
      'The secret scanner wrote a report in a shape this command does not read.',
    );
  }

  return report.data
    .map(({ RuleID, File, StartLine }) => ({
      ruleId: RuleID,
      path: normalizeRepositoryPath(File) ?? File,
      line: StartLine,
    }))
    .sort(compareFindings);
}

export interface GitleaksArgumentOptions {
  /** The project's `.gitleaks.toml`, which the CI gate reads as well. */
  configurationFile: string;
  /** The directory holding the project's `.gitleaksignore`, if it has one. */
  ignoreDirectory: string;
  /** Where the report goes: outside the repository, and deleted after reading. */
  reportFile: string;
}

/**
 * The command line for a `gitleaks dir` scan of the current directory.
 *
 * Directory mode reads the files rather than a `git diff`, so a
 * `.gitattributes` entry that makes Git show a generated file as binary cannot
 * hide it. `--ignore-gitleaks-allow` keeps an author from waving a value through
 * by typing the marker into a document: a false positive is allowlisted in
 * reviewed configuration, not in the content itself.
 */
export function gitleaksArguments(options: GitleaksArgumentOptions): string[] {
  return [
    'dir',
    '--no-banner',
    '--log-level',
    'error',
    '--config',
    options.configurationFile,
    '--gitleaks-ignore-path',
    options.ignoreDirectory,
    '--ignore-gitleaks-allow',
    '--redact=100',
    '--report-format',
    'json',
    '--report-path',
    options.reportFile,
    '--exit-code',
    String(GITLEAKS_FINDINGS_EXIT_CODE),
    '.',
  ];
}

/**
 * Which Google file a generated path came from, as far as the manifest says: a
 * document's Markdown and everything in its asset directory, and a folder's
 * section page. The sidebar, the redirect map and the data files belong to no
 * single file, and neither does a path in a manifest that cannot be read.
 */
export function createGoogleFileIdResolver(
  manifest: unknown,
): (path: string) => string | undefined {
  const parsed = syncManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    return () => undefined;
  }

  const files = new Map<string, string>();
  const assetDirectories: [prefix: string, fileId: string][] = [];
  for (const document of Object.values(parsed.data.documents)) {
    files.set(document.generatedMarkdownPath, document.googleFileId);
    assetDirectories.push([
      `${document.generatedAssetsDirectory}/`,
      document.googleFileId,
    ]);
  }
  for (const folder of Object.values(parsed.data.folders)) {
    if (folder.generatedMarkdownPath) {
      files.set(folder.generatedMarkdownPath, folder.googleFolderId);
    }
  }

  return (path) =>
    files.get(path) ??
    assetDirectories.find(([prefix]) => path.startsWith(prefix))?.[1];
}

/** One finding as a log line: where it is and what matched, never the value. */
export function describeSecretFinding(
  finding: SecretFinding,
  googleFileId: string | undefined,
): string {
  return [
    `rule=${finding.ruleId}`,
    `path=${finding.path}`,
    `line=${finding.line}`,
    ...(googleFileId ? [`fileId=${googleFileId}`] : []),
  ].join(' ');
}

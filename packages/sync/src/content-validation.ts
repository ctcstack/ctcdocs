import { execFile } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import {
  GENERATED_DIRECTORY_ALLOWLIST,
  isGeneratedPathAllowed,
  PROJECT_LAYOUT,
  type SiteConfiguration,
} from '@ctcstack/ctcdocs-core';
import { parse as parseJsonWithComments } from 'jsonc-parser';
import { parse as parseToml } from 'smol-toml';
import { z } from 'zod';

import type { SyncContext } from './project-context.js';

const runCommand = promisify(execFile);

function protectedEnvironmentSchema(pattern: string) {
  return z
    .object({
      workers_dev: z.literal(false),
      preview_urls: z.literal(false),
      routes: z
        .array(
          z.object({
            pattern: z.literal(pattern),
            custom_domain: z.literal(true),
          }),
        )
        .length(1),
    })
    .strict();
}

/*
 * Wrangler reads its own configuration file, so the deployment target cannot be
 * injected from site.config.json at deploy time. It is checked against it
 * instead: the Worker name and every custom domain have to be the ones the
 * project declares, the set of environments has to match exactly, and no
 * environment may fall back to a public workers.dev or preview hostname.
 */
function wranglerConfigurationSchema(site: SiteConfiguration) {
  const { deployment } = site;
  const environments = Object.fromEntries(
    Object.entries(deployment.environments).map(([name, environment]) => [
      name,
      protectedEnvironmentSchema(environment.hostname),
    ]),
  );

  return z.object({
    name: z.literal(deployment.workerName),
    workers_dev: z.literal(false),
    preview_urls: z.literal(false),
    assets: z.object({
      directory: z.literal('./dist'),
      not_found_handling: z.literal('404-page'),
      html_handling: z.literal('auto-trailing-slash'),
    }),
    env: z.object(environments).strict(),
  });
}

/**
 * Response headers a protected deployment cannot go without.
 *
 * The rules matter most for the two surfaces that serve document content
 * outside an HTML page: the Markdown projection and the original images. Both
 * must be privately cached and kept out of indexes, and neither is covered by
 * the `noindex` meta tag that protects a rendered page.
 */
const REQUIRED_HEADER_RULES = [
  { directives: ['cache-control: private', 'x-robots-tag'], pattern: '/*.md' },
  {
    directives: ['cache-control: private', 'x-robots-tag'],
    pattern: '/assets/generated/*',
  },
] as const;

export interface ValidationResult {
  errors: string[];
  checkedFiles: number;
  /**
   * Whether the project has a generated corpus at all. A repository that has
   * never synced is valid — it just has nothing to build yet — and the caller
   * decides whether that is expected.
   */
  hasCorpus: boolean;
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

async function listFilesRecursively(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        return listFilesRecursively(absolutePath);
      }
      return entry.isFile() ? [absolutePath] : [];
    }),
  );

  return nestedFiles.flat().sort();
}

/**
 * A Cloudflare `_headers` file, read as rules rather than as text: a line that
 * begins in column one opens a rule, and the indented lines under it are its
 * headers. Matching the file with a regular expression would accept a directive
 * that belongs to the wrong pattern.
 */
function parseHeaderRules(content: string): Map<string, string[]> {
  const rules = new Map<string, string[]>();
  let current: string[] | undefined;

  for (const line of content.split(/\r?\n/u)) {
    const withoutComment = line.split('#')[0] ?? '';
    if (withoutComment.trim().length === 0) {
      continue;
    }
    if (/^\s/u.test(withoutComment)) {
      current?.push(withoutComment.trim().toLowerCase());
      continue;
    }
    current = [];
    rules.set(withoutComment.trim(), current);
  }

  return rules;
}

async function validateHeaders(repositoryRoot: string): Promise<string[]> {
  const errors: string[] = [];
  const content = await readFile(
    resolve(repositoryRoot, PROJECT_LAYOUT.headersFile),
    'utf8',
  );
  const rules = parseHeaderRules(content);

  for (const required of REQUIRED_HEADER_RULES) {
    const headers = rules.get(required.pattern);
    if (!headers) {
      errors.push(
        `${PROJECT_LAYOUT.headersFile} must carry a rule for ${required.pattern}`,
      );
      continue;
    }
    for (const directive of required.directives) {
      if (!headers.some((header) => header.startsWith(directive))) {
        errors.push(
          `${PROJECT_LAYOUT.headersFile} rule ${required.pattern} must set ${directive}`,
        );
      }
    }
  }

  return errors;
}

/** Every `paths` entry of every allowlist in a gitleaks configuration. */
function gitleaksExemptPatterns(content: string): string[] {
  const parsed = parseToml(content) as Record<string, unknown>;
  const allowlists = [
    ...(Array.isArray(parsed.allowlists) ? parsed.allowlists : []),
    ...(parsed.allowlist === undefined ? [] : [parsed.allowlist]),
  ];

  return allowlists.flatMap((allowlist) => {
    const paths = (allowlist as Record<string, unknown>).paths;
    return Array.isArray(paths)
      ? paths.filter((path): path is string => typeof path === 'string')
      : [];
  });
}

/**
 * The secret scanner's path allowlist applies to history as well as to the
 * working directory, so an exempt path that Git tracks is a file secrets could
 * hide in. This is the check that keeps the exemption honest, and it replaces
 * the shell script every project used to carry a copy of.
 */
async function validateSecretScanExemptions(
  repositoryRoot: string,
): Promise<string[]> {
  const configurationPath = resolve(
    repositoryRoot,
    PROJECT_LAYOUT.gitleaksConfigurationFile,
  );
  if (!(await pathExists(configurationPath))) {
    return [
      `${PROJECT_LAYOUT.gitleaksConfigurationFile} is missing; secret scanning has no configuration`,
    ];
  }

  const patterns: RegExp[] = [];
  const errors: string[] = [];
  for (const pattern of gitleaksExemptPatterns(
    await readFile(configurationPath, 'utf8'),
  )) {
    try {
      patterns.push(new RegExp(pattern));
    } catch {
      errors.push(
        `${PROJECT_LAYOUT.gitleaksConfigurationFile} exempts a path pattern that cannot be interpreted: ${pattern}`,
      );
    }
  }
  if (patterns.length === 0) {
    return errors;
  }

  let tracked: string[];
  try {
    const { stdout } = await runCommand('git', ['ls-files', '-z'], {
      cwd: repositoryRoot,
      maxBuffer: 64 * 1024 * 1024,
    });
    tracked = stdout.split('\0').filter((path) => path.length > 0);
  } catch {
    // Outside a Git working tree — a released tarball, a container build —
    // there is nothing to be tracked, and nothing to check.
    return errors;
  }

  for (const path of tracked) {
    if (patterns.some((pattern) => pattern.test(path))) {
      errors.push(
        `Git tracks ${path}, which the secret scanner is configured to ignore. Remove it from the index and rotate anything it exposed.`,
      );
    }
  }

  return errors;
}

export async function validateRepositoryContent(
  context: SyncContext,
): Promise<ValidationResult> {
  const { markdownHeader, repositoryRoot, site } = context;
  const errors: string[] = [];
  let checkedFiles = 0;

  const robotsContent = await readFile(
    resolve(repositoryRoot, PROJECT_LAYOUT.robotsFile),
    'utf8',
  );
  checkedFiles += 1;
  if (!robotsContent.includes('Disallow: /')) {
    errors.push('robots.txt must disallow all crawlers');
  }

  errors.push(...(await validateHeaders(repositoryRoot)));
  checkedFiles += 1;

  const wranglerContent = await readFile(
    resolve(repositoryRoot, PROJECT_LAYOUT.wranglerConfigurationFile),
    'utf8',
  );
  checkedFiles += 1;
  try {
    wranglerConfigurationSchema(site).parse(
      parseJsonWithComments(wranglerContent),
    );
  } catch {
    const names = Object.keys(site.deployment.environments).sort().join(', ');
    errors.push(
      `${PROJECT_LAYOUT.wranglerConfigurationFile} must deploy Worker ${site.deployment.workerName} to exactly these environments and their configured hostnames, with public Worker URLs disabled: ${names}`,
    );
  }

  errors.push(...(await validateSecretScanExemptions(repositoryRoot)));
  checkedFiles += 1;

  const hasCorpus = await pathExists(
    resolve(repositoryRoot, PROJECT_LAYOUT.manifestFile),
  );

  for (const allowedDirectory of GENERATED_DIRECTORY_ALLOWLIST) {
    const absoluteDirectory = resolve(repositoryRoot, allowedDirectory);
    if (!(await pathExists(absoluteDirectory))) {
      continue;
    }

    for (const absolutePath of await listFilesRecursively(absoluteDirectory)) {
      const repositoryPath = relative(repositoryRoot, absolutePath);
      checkedFiles += 1;

      if (!isGeneratedPathAllowed(repositoryPath)) {
        errors.push(
          `Generated file is outside the allowlist: ${repositoryPath}`,
        );
        continue;
      }

      if (
        allowedDirectory === PROJECT_LAYOUT.generatedDocumentsDirectory &&
        !repositoryPath.endsWith('.md')
      ) {
        errors.push(`Generated content must use .md: ${repositoryPath}`);
        continue;
      }

      if (repositoryPath.endsWith('.md')) {
        const content = await readFile(absolutePath, 'utf8');
        if (!content.includes(markdownHeader)) {
          errors.push(
            `Generated Markdown has no ownership header: ${repositoryPath}`,
          );
        }
      }
    }
  }

  return { checkedFiles, errors, hasCorpus };
}

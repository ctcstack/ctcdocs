import { execFile } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import {
  GENERATED_DIRECTORY_ALLOWLIST,
  GENERATED_FILE_ALLOWLIST,
  isGeneratedPathAllowed,
  PLATFORM_WORKERS,
  PROJECT_LAYOUT,
  type DeploymentVisibility,
  type SiteConfiguration,
} from '@ctcstack/ctcdocs-core';
import { parse as parseJsonWithComments } from 'jsonc-parser';
import { z } from 'zod';

import { gitleaksExemptPatterns } from './gitleaks-configuration.js';
import type { SyncContext } from './project-context.js';

const runCommand = promisify(execFile);

/** The KV namespace a private environment's Workers keep the snapshot in. */
const stateNamespaceSchema = z
  .array(
    z
      .object({
        binding: z.literal(PLATFORM_WORKERS.stateBinding),
        id: z.string().min(1),
      })
      .strict(),
  )
  .length(1);

function protectedEnvironmentSchema(pattern: string, gated: boolean) {
  const base = {
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
  };
  return gated
    ? z
        .object({
          ...base,
          kv_namespaces: stateNamespaceSchema,
          vars: z.object({ GOOGLE_CLIENT_ID: z.string().min(1) }).strict(),
        })
        .strict()
    : z.object(base).strict();
}

const accessMapAliasSchema = z
  .object({
    [PLATFORM_WORKERS.accessMapAlias]: z.literal(
      `./${PROJECT_LAYOUT.accessMapFile}`,
    ),
  })
  .strict();

/*
 * Wrangler reads its own configuration file, so the deployment target cannot be
 * injected from site.config.json at deploy time. It is checked against it
 * instead: the Worker name and every custom domain have to be the ones the
 * project declares, the set of environments has to match exactly, and no
 * environment may fall back to a public workers.dev or preview hostname.
 */
/**
 * Whether the deployment is served through the platform's Worker: when any
 * environment is private, since the Worker is one artifact for them all.
 */
function isGated(site: SiteConfiguration): boolean {
  return Object.values(site.deployment.environments).some(
    (environment) => environment.visibility === 'private',
  );
}

function wranglerConfigurationSchema(site: SiteConfiguration) {
  const { deployment } = site;
  const gated = isGated(site);
  const environments = Object.fromEntries(
    Object.entries(deployment.environments).map(([name, environment]) => [
      name,
      protectedEnvironmentSchema(environment.hostname, gated),
    ]),
  );
  const assets = {
    directory: z.literal('./dist'),
    not_found_handling: z.literal('404-page'),
    html_handling: z.literal('auto-trailing-slash'),
  };

  /*
   * A private deployment is served through the platform's Worker, which runs
   * before every asset and is bundled with the build's access map (ADR-038).
   */
  return gated
    ? z.object({
        name: z.literal(deployment.workerName),
        main: z.literal(PLATFORM_WORKERS.gate),
        workers_dev: z.literal(false),
        preview_urls: z.literal(false),
        alias: accessMapAliasSchema,
        assets: z.object({
          ...assets,
          binding: z.literal('ASSETS'),
          run_worker_first: z.literal(true),
        }),
        env: z.object(environments).strict(),
      })
    : z.object({
        name: z.literal(deployment.workerName),
        workers_dev: z.literal(false),
        preview_urls: z.literal(false),
        assets: z.object(assets),
        env: z.object(environments).strict(),
      });
}

/**
 * The scheduled Worker that refreshes the directory snapshot (ADR-040): no
 * route and no public URL, the platform's entry, the same access map and the
 * same KV namespace as the site's Worker in each environment.
 */
function directoryWranglerSchema(
  site: SiteConfiguration,
  namespaces: Readonly<Record<string, string>>,
) {
  const environments = Object.fromEntries(
    Object.keys(site.deployment.environments).map((name) => [
      name,
      z
        .object({
          workers_dev: z.literal(false),
          preview_urls: z.literal(false),
          kv_namespaces: z
            .array(
              z
                .object({
                  binding: z.literal(PLATFORM_WORKERS.stateBinding),
                  id: z.literal(namespaces[name] ?? ''),
                })
                .strict(),
            )
            .length(1),
        })
        .strict(),
    ]),
  );
  return z.object({
    name: z.literal(`${site.deployment.workerName}-directory`),
    main: z.literal(PLATFORM_WORKERS.directory),
    // Environments inherit a top-level route; this Worker has none.
    route: z.never().optional(),
    routes: z.never().optional(),
    workers_dev: z.literal(false),
    preview_urls: z.literal(false),
    alias: accessMapAliasSchema,
    triggers: z
      .object({
        crons: z.tuple([z.literal(PLATFORM_WORKERS.directorySchedule)]),
      })
      .strict(),
    env: z.object(environments).strict(),
  });
}

/**
 * The two surfaces that serve document content outside an HTML page: the
 * Markdown projection and the original images. Neither is covered by the meta
 * tag on a rendered page, so whatever a deployment claims about who may read it
 * has to be true of these as well.
 *
 * On a private deployment they must be cached privately and kept out of
 * indexes. On a public one the same rules would be a defect — a portal nobody
 * can index is a portal nobody finds — so the check inverts rather than
 * disappearing.
 */
/**
 * Paths that serve document content. The `llms.txt` indexes carry every
 * document's title and description (ADR-033), so they are content too.
 */
const CONTENT_SURFACES = [
  '/*.md',
  '/llms.txt',
  '/*/llms.txt',
  '/assets/generated/*',
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

/**
 * Whether Git ignores a path in the repository, or `undefined` where Git
 * cannot say: not installed, or not a repository.
 */
async function gitIgnores(
  repositoryRoot: string,
  path: string,
): Promise<boolean | undefined> {
  try {
    await runCommand('git', ['check-ignore', '--quiet', '--no-index', path], {
      cwd: repositoryRoot,
    });
    return true;
  } catch (error: unknown) {
    return (error as { code?: unknown }).code === 1 ? false : undefined;
  }
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

async function validateHeaders(
  repositoryRoot: string,
  visibility: DeploymentVisibility,
): Promise<string[]> {
  const errors: string[] = [];
  const content = await readFile(
    resolve(repositoryRoot, PROJECT_LAYOUT.headersFile),
    'utf8',
  );
  const rules = parseHeaderRules(content);

  for (const pattern of CONTENT_SURFACES) {
    const headers = rules.get(pattern);
    if (visibility === 'public') {
      if (headers?.some((header) => header.includes('noindex'))) {
        errors.push(
          `${PROJECT_LAYOUT.headersFile} rule ${pattern} keeps a public deployment out of search indexes`,
        );
      }
      continue;
    }
    if (!headers) {
      errors.push(
        `${PROJECT_LAYOUT.headersFile} must carry a rule for ${pattern}`,
      );
      continue;
    }
    for (const directive of ['cache-control: private', 'x-robots-tag']) {
      if (!headers.some((header) => header.startsWith(directive))) {
        errors.push(
          `${PROJECT_LAYOUT.headersFile} rule ${pattern} must set ${directive}`,
        );
      }
    }
  }

  return errors;
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

/**
 * A file each generated directory holds, standing in for all of them. The sync
 * writes nested paths — a folder per Drive folder, a directory per image — so
 * the stand-in is nested too, and a rule that only matches the top level of a
 * directory does not pass for one that covers it. The asset stands in as SVG
 * because that is the one image format a Prettier plugin can format.
 */
const REPRESENTATIVE_GENERATED_FILES: Record<
  (typeof GENERATED_DIRECTORY_ALLOWLIST)[number],
  string
> = {
  [PROJECT_LAYOUT.generatedDocumentsDirectory]: 'folder/document.md',
  [PROJECT_LAYOUT.generatedAssetsDirectory]: 'file/image.svg',
  [PROJECT_LAYOUT.generatedSourceDirectory]: 'module.ts',
};

/** The ignore files `prettier --check .` reads from the directory it runs in. */
const PRETTIER_IGNORE_FILES = ['.gitignore', '.prettierignore'] as const;

/**
 * The sync writes generated output byte for byte, and a project's verification
 * runs `prettier --check .` over the whole repository. A generated path the
 * formatter does not ignore fails that check the first time the sync writes it
 * — after a complete export, and with nothing a project could have run locally
 * to see it coming, since the file does not exist yet. So the question is put
 * to Prettier itself, for every path the allowlist names, before any of them
 * exists.
 *
 * Prettier is imported here rather than at the top of the module so that the
 * commands that never ask it anything do not load it.
 */
async function validateFormatterIgnoresGeneratedPaths(
  repositoryRoot: string,
): Promise<string[]> {
  const { getFileInfo } = await import('prettier');
  const ignorePath = PRETTIER_IGNORE_FILES.map((file) =>
    resolve(repositoryRoot, file),
  );

  const candidates = [
    ...GENERATED_DIRECTORY_ALLOWLIST.map((directory) => ({
      reported: `${directory}/`,
      probe: `${directory}/${REPRESENTATIVE_GENERATED_FILES[directory]}`,
    })),
    ...GENERATED_FILE_ALLOWLIST.map((file) => ({
      reported: file,
      probe: file,
    })),
  ];

  const formatted: string[] = [];
  for (const { reported, probe } of candidates) {
    const { ignored, inferredParser } = await getFileInfo(
      resolve(repositoryRoot, probe),
      { ignorePath },
    );
    if (!ignored && inferredParser !== null) {
      formatted.push(reported);
    }
  }

  if (formatted.length === 0) {
    return [];
  }
  return [
    `Prettier would format generated paths that the sync writes byte for byte, so \`prettier --check .\` fails once they are written: ${formatted.join(', ')}. Add them to .prettierignore.`,
  ];
}

export async function validateRepositoryContent(
  context: SyncContext,
): Promise<ValidationResult> {
  const { markdownHeader, repositoryRoot, site } = context;
  const errors: string[] = [];
  let checkedFiles = 0;

  /*
   * The built site is one artifact deployed to every environment, so the two
   * files that describe it to crawlers follow the production environment. The
   * per-environment setting still decides what the smoke test asserts about
   * each hostname.
   */
  const visibility = site.deployment.environments.production.visibility;

  const robotsContent = await readFile(
    resolve(repositoryRoot, PROJECT_LAYOUT.robotsFile),
    'utf8',
  );
  checkedFiles += 1;
  const disallowsEverything = /^\s*Disallow:\s*\/\s*$/mu.test(robotsContent);
  if (visibility === 'private' && !disallowsEverything) {
    errors.push('robots.txt must disallow all crawlers');
  }
  if (visibility === 'public' && disallowsEverything) {
    errors.push(
      'robots.txt disallows every crawler, which hides a public deployment',
    );
  }

  errors.push(...(await validateHeaders(repositoryRoot, visibility)));
  checkedFiles += 1;

  const wranglerContent = await readFile(
    resolve(repositoryRoot, PROJECT_LAYOUT.wranglerConfigurationFile),
    'utf8',
  );
  checkedFiles += 1;
  const wrangler: unknown = parseJsonWithComments(wranglerContent);
  const names = Object.keys(site.deployment.environments).sort().join(', ');
  const gated = isGated(site);
  try {
    wranglerConfigurationSchema(site).parse(wrangler);
  } catch {
    errors.push(
      gated
        ? `${PROJECT_LAYOUT.wranglerConfigurationFile} must deploy Worker ${site.deployment.workerName} with main ${PLATFORM_WORKERS.gate}, the ASSETS binding, run_worker_first, the ${PLATFORM_WORKERS.accessMapAlias} alias, and in each environment its configured hostname, public Worker URLs disabled, the ${PLATFORM_WORKERS.stateBinding} KV namespace and a GOOGLE_CLIENT_ID var: ${names}`
        : `${PROJECT_LAYOUT.wranglerConfigurationFile} must deploy Worker ${site.deployment.workerName} to exactly these environments and their configured hostnames, with public Worker URLs disabled: ${names}`,
    );
  }

  if (gated) {
    /*
     * The asset store applies `_redirects` before it serves a file, so a rule
     * there could answer one path with another file's bytes; the Worker
     * refuses such answers, and validation keeps them from being written.
     */
    if (await pathExists(resolve(repositoryRoot, 'public', '_redirects'))) {
      errors.push(
        'public/_redirects is not allowed on a private deployment: the Worker serves only the file it judged, and the platform writes its own redirects',
      );
    }
    if (!site.signIn) {
      errors.push(
        `${PROJECT_LAYOUT.configurationFile} must name the Workspace domains readers sign in with (signIn.workspaceDomains) for a private deployment`,
      );
    }
    const namespaces = Object.fromEntries(
      Object.entries(
        ((wrangler as { env?: Record<string, unknown> }).env ?? {}) as Record<
          string,
          { kv_namespaces?: Array<{ id?: string }> }
        >,
      ).map(([name, environment]) => [
        name,
        environment.kv_namespaces?.[0]?.id ?? '',
      ]),
    );
    const directoryPath = resolve(
      repositoryRoot,
      PROJECT_LAYOUT.directoryWranglerConfigurationFile,
    );
    const directoryContent = await readFile(directoryPath, 'utf8').catch(
      () => undefined,
    );
    checkedFiles += 1;
    if (directoryContent === undefined) {
      errors.push(
        `${PROJECT_LAYOUT.directoryWranglerConfigurationFile} is missing; a private deployment refreshes its directory snapshot with it`,
      );
    } else {
      try {
        directoryWranglerSchema(site, namespaces).parse(
          parseJsonWithComments(directoryContent),
        );
      } catch {
        errors.push(
          `${PROJECT_LAYOUT.directoryWranglerConfigurationFile} must deploy Worker ${site.deployment.workerName}-directory with main ${PLATFORM_WORKERS.directory}, the ${PLATFORM_WORKERS.accessMapAlias} alias, the cron ${PLATFORM_WORKERS.directorySchedule}, no route or public URL, and in each environment the site Worker's ${PLATFORM_WORKERS.stateBinding} namespace: ${names}`,
        );
      }
    }
  }

  errors.push(...(await validateSecretScanExemptions(repositoryRoot)));
  checkedFiles += 1;

  if (
    (await gitIgnores(repositoryRoot, PROJECT_LAYOUT.accessMapFile)) === false
  ) {
    errors.push(
      `${PROJECT_LAYOUT.accessMapFile} is not ignored by Git; add ${PROJECT_LAYOUT.accessMapFile.split('/')[0]}/ to .gitignore, or every build leaves a change outside the generated paths`,
    );
  }

  errors.push(
    ...(await validateFormatterIgnoresGeneratedPaths(repositoryRoot)),
  );
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

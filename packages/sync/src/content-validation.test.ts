import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  GENERATED_DIRECTORY_ALLOWLIST,
  GENERATED_FILE_ALLOWLIST,
  parseSiteConfiguration,
  PLATFORM_WORKERS,
  PROJECT_LAYOUT,
} from '@ctcstack/ctcdocs-core';
import { afterEach, describe, expect, it } from 'vitest';

import { validateRepositoryContent } from './content-validation.js';
import { createSyncContext, type SyncContext } from './project-context.js';
import {
  publicSiteConfiguration,
  TEST_MARKDOWN_HEADER,
  TEST_SITE_CONFIGURATION_INPUT,
  testSiteConfiguration,
  testSyncContext,
} from './test-support/project-fixture.js';

const runCommand = promisify(execFile);
const { deployment } = testSiteConfiguration;
const temporaryDirectories: string[] = [];

const PUBLIC_HEADERS = `/*.md
  Cache-Control: public, max-age=300

/llms.txt
  Cache-Control: public, max-age=300

/*/llms.txt
  Cache-Control: public, max-age=300

/assets/generated/*
  Cache-Control: public, max-age=300
`;

const PROTECTED_HEADERS = `/*.md
  Cache-Control: private, max-age=60, must-revalidate
  X-Robots-Tag: noindex, noarchive

/llms.txt
  Cache-Control: private, max-age=60, must-revalidate
  X-Robots-Tag: noindex, noarchive

/*/llms.txt
  Cache-Control: private, max-age=60, must-revalidate
  X-Robots-Tag: noindex, noarchive

/assets/generated/*
  Cache-Control: private, max-age=60, must-revalidate
  X-Robots-Tag: noindex, noarchive
`;

const GITLEAKS_CONFIGURATION = `[extend]
useDefault = true

[[allowlists]]
description = "Local credential material that must never be committed"
paths = [
  '''^\\.env$''',
]
`;

/**
 * What a project's `.prettierignore` holds for the paths the sync owns: each
 * generated directory as a whole, and each generated file.
 */
const GENERATED_PRETTIER_IGNORE = [
  ...GENERATED_DIRECTORY_ALLOWLIST.map((directory) => `${directory}/`),
  ...GENERATED_FILE_ALLOWLIST,
];

function prettierIgnore(paths: readonly string[]): string {
  return `node_modules/\ndist/\n\n${paths.join('\n')}\n`;
}

interface FixtureOptions {
  robots?: string;
  visibility?: 'private' | 'public';
  headers?: string;
  gitleaks?: string;
  prettierIgnore?: string;
  generatedName?: string;
  generatedContent?: string;
  routePattern?: string;
  workersDev?: boolean;
  extraEnvironment?: boolean;
  withoutCorpus?: boolean;
  /** Write a private deployment's Wrangler file without the Worker gate. */
  withoutGate?: boolean;
  withoutDirectory?: boolean;
  directoryNamespace?: string;
}

async function createProject(options: FixtureOptions = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'content-validation-'));
  temporaryDirectories.push(root);

  await mkdir(join(root, PROJECT_LAYOUT.publicDirectory), { recursive: true });
  await writeFile(
    join(root, PROJECT_LAYOUT.robotsFile),
    options.robots ??
      (options.visibility === 'public'
        ? 'User-agent: *\nAllow: /\n'
        : 'User-agent: *\nDisallow: /\n'),
  );
  await writeFile(
    join(root, PROJECT_LAYOUT.headersFile),
    options.headers ??
      (options.visibility === 'public' ? PUBLIC_HEADERS : PROTECTED_HEADERS),
  );
  await writeFile(
    join(root, PROJECT_LAYOUT.gitleaksConfigurationFile),
    options.gitleaks ?? GITLEAKS_CONFIGURATION,
  );
  await writeFile(
    join(root, '.prettierignore'),
    options.prettierIgnore ?? prettierIgnore(GENERATED_PRETTIER_IGNORE),
  );
  const gated = options.visibility !== 'public' && !options.withoutGate;
  const alias = {
    [PLATFORM_WORKERS.accessMapAlias]: `./${PROJECT_LAYOUT.accessMapFile}`,
  };
  await writeFile(
    join(root, PROJECT_LAYOUT.wranglerConfigurationFile),
    JSON.stringify({
      name: deployment.workerName,
      ...(gated ? { main: PLATFORM_WORKERS.gate, alias } : {}),
      workers_dev: options.workersDev ?? false,
      preview_urls: false,
      assets: {
        directory: './dist',
        not_found_handling: '404-page',
        html_handling: 'auto-trailing-slash',
        ...(gated ? { binding: 'ASSETS', run_worker_first: true } : {}),
      },
      env: {
        production: {
          workers_dev: options.workersDev ?? false,
          preview_urls: false,
          routes: [
            {
              pattern:
                options.routePattern ??
                deployment.environments.production.hostname,
              custom_domain: true,
            },
          ],
          ...(gated
            ? {
                kv_namespaces: [
                  {
                    binding: PLATFORM_WORKERS.stateBinding,
                    id: 'kv-production',
                  },
                ],
                vars: { GOOGLE_CLIENT_ID: 'client.apps.googleusercontent.com' },
              }
            : {}),
        },
        ...(options.extraEnvironment
          ? { public: { workers_dev: true, preview_urls: true } }
          : {}),
      },
    }),
  );
  if (options.visibility !== 'public' && !options.withoutDirectory) {
    await writeFile(
      join(root, PROJECT_LAYOUT.directoryWranglerConfigurationFile),
      JSON.stringify({
        name: `${deployment.workerName}-directory`,
        main: PLATFORM_WORKERS.directory,
        workers_dev: false,
        preview_urls: false,
        alias,
        triggers: { crons: [PLATFORM_WORKERS.directorySchedule] },
        env: {
          production: {
            workers_dev: false,
            preview_urls: false,
            kv_namespaces: [
              {
                binding: PLATFORM_WORKERS.stateBinding,
                id: options.directoryNamespace ?? 'kv-production',
              },
            ],
          },
        },
      }),
    );
  }

  if (!options.withoutCorpus) {
    await mkdir(join(root, PROJECT_LAYOUT.generatedDocumentsDirectory), {
      recursive: true,
    });
    await mkdir(join(root, 'data'), { recursive: true });
    await writeFile(join(root, PROJECT_LAYOUT.manifestFile), '{}');
    await writeFile(
      join(
        root,
        PROJECT_LAYOUT.generatedDocumentsDirectory,
        options.generatedName ?? 'fixture.md',
      ),
      options.generatedContent ??
        `---\ntitle: Fixture\n---\n${TEST_MARKDOWN_HEADER}\n\n# Fixture\n`,
    );
  }

  return root;
}

function contextFor(root: string, options: FixtureOptions): SyncContext {
  return options.visibility === 'public'
    ? createSyncContext(root, publicSiteConfiguration)
    : testSyncContext(root);
}

async function validate(options: FixtureOptions = {}) {
  const root = await createProject(options);
  return validateRepositoryContent(contextFor(root, options));
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('repository content validation', () => {
  it('accepts a protected deployment with owned Markdown', async () => {
    const result = await validate();

    expect(result.errors).toEqual([]);
    expect(result.hasCorpus).toBe(true);
  });

  it('reports a project that has never synchronized without failing it', async () => {
    const result = await validate({ withoutCorpus: true });

    expect(result.errors).toEqual([]);
    expect(result.hasCorpus).toBe(false);
  });

  it('reports public configuration, non-Markdown output, and a missing header', async () => {
    const result = await validate({
      robots: 'User-agent: *\nAllow: /\n',
      generatedName: 'fixture.mdx',
      generatedContent: '# Unsafe fixture\n',
      workersDev: true,
    });

    expect(result.errors).toEqual([
      'robots.txt must disallow all crawlers',
      expect.stringContaining('must deploy Worker'),
      expect.stringContaining('Generated content must use .md'),
    ]);
  });

  it('rejects a custom domain the project did not configure', async () => {
    const result = await validate({ routePattern: 'public-docs.example.com' });

    expect(result.errors).toEqual([
      expect.stringContaining('must deploy Worker'),
    ]);
  });

  it('rejects an environment the project did not configure', async () => {
    const result = await validate({ extraEnvironment: true });

    expect(result.errors).toEqual([
      expect.stringContaining('must deploy Worker'),
    ]);
  });

  it('reports generated Markdown without an ownership header', async () => {
    const result = await validate({ generatedContent: '# Missing header\n' });

    expect(result.errors).toEqual([
      expect.stringContaining('Generated Markdown has no ownership header'),
    ]);
  });

  it('rejects headers that would let a proxy or crawler keep document content', async () => {
    const result = await validate({
      headers: `/*.md
  Cache-Control: public, max-age=60
  X-Robots-Tag: noindex
`,
    });

    expect(result.errors).toEqual([
      expect.stringContaining('rule /*.md must set cache-control: private'),
      expect.stringContaining('must carry a rule for /llms.txt'),
      expect.stringContaining('must carry a rule for /*/llms.txt'),
      expect.stringContaining('must carry a rule for /assets/generated/*'),
    ]);
  });

  it('rejects a secret-scanner exemption that Git actually tracks', async () => {
    const root = await createProject();
    await runCommand('git', ['init', '--quiet'], { cwd: root });
    await writeFile(join(root, '.gitignore'), '.ctcdocs/\n');
    await writeFile(join(root, '.env'), 'TOKEN=synthetic\n');
    await runCommand('git', ['add', '--force', '.env'], { cwd: root });

    const result = await validateRepositoryContent(testSyncContext(root));

    expect(result.errors).toEqual([expect.stringContaining('Git tracks .env')]);
  });

  it('reports a missing secret-scanner configuration', async () => {
    const root = await createProject();
    await rm(join(root, PROJECT_LAYOUT.gitleaksConfigurationFile));

    const result = await validateRepositoryContent(testSyncContext(root));

    expect(result.errors).toEqual([
      expect.stringContaining('secret scanning has no configuration'),
    ]);
  });
});

describe('generated paths and the formatter', () => {
  it('accepts a project whose formatter ignores every generated path', async () => {
    const result = await validate({ withoutCorpus: true });

    expect(result.errors).toEqual([]);
  });

  it('accepts a project that ignores everything', async () => {
    const result = await validate({ prettierIgnore: '*\n' });

    expect(result.errors).toEqual([]);
  });

  it('names a generated file the formatter would check', async () => {
    const result = await validate({
      withoutCorpus: true,
      prettierIgnore: prettierIgnore(
        GENERATED_PRETTIER_IGNORE.filter(
          (path) => path !== PROJECT_LAYOUT.titleReportFile,
        ),
      ),
    });

    expect(result.errors).toEqual([
      `Prettier would format generated paths that the sync writes byte for byte, so \`prettier --check .\` fails once they are written: ${PROJECT_LAYOUT.titleReportFile}. Add them to .prettierignore.`,
    ]);
  });

  it('does not accept a rule that covers only the top of a generated directory', async () => {
    const result = await validate({
      prettierIgnore: prettierIgnore([
        ...GENERATED_PRETTIER_IGNORE.filter(
          (path) => path !== `${PROJECT_LAYOUT.generatedDocumentsDirectory}/`,
        ),
        `${PROJECT_LAYOUT.generatedDocumentsDirectory}/*.md`,
      ]),
    });

    expect(result.errors).toEqual([
      expect.stringContaining(
        `: ${PROJECT_LAYOUT.generatedDocumentsDirectory}/. Add them`,
      ),
    ]);
  });

  it('reports every generated path when there is nothing to ignore them', async () => {
    const root = await createProject({ withoutCorpus: true });
    await rm(join(root, '.prettierignore'));

    const result = await validateRepositoryContent(testSyncContext(root));

    expect(result.errors).toHaveLength(1);
    for (const path of [
      `${PROJECT_LAYOUT.generatedDocumentsDirectory}/`,
      `${PROJECT_LAYOUT.generatedSourceDirectory}/`,
      ...GENERATED_FILE_ALLOWLIST,
    ]) {
      expect(result.errors[0]).toContain(path);
    }
  });

  it('honours the ignore rules Prettier reads from .gitignore', async () => {
    const root = await createProject({
      withoutCorpus: true,
      prettierIgnore: prettierIgnore(
        GENERATED_PRETTIER_IGNORE.filter(
          (path) => path !== PROJECT_LAYOUT.titleReportFile,
        ),
      ),
    });
    await writeFile(
      join(root, '.gitignore'),
      `${PROJECT_LAYOUT.titleReportFile}\n`,
    );

    const result = await validateRepositoryContent(testSyncContext(root));

    expect(result.errors).toEqual([]);
  });
});

describe('a deployment anyone may read', () => {
  it('accepts a portal that invites crawlers and caches publicly', async () => {
    const result = await validate({ visibility: 'public' });

    expect(result.errors).toEqual([]);
  });

  it('rejects a portal hidden from every crawler', async () => {
    const result = await validate({
      visibility: 'public',
      robots: 'User-agent: *\nDisallow: /\n',
    });

    expect(result.errors).toEqual([
      expect.stringContaining('hides a public deployment'),
    ]);
  });

  it('rejects response headers that keep a portal out of search indexes', async () => {
    const result = await validate({
      visibility: 'public',
      headers: `/*.md
  Cache-Control: public, max-age=300
  X-Robots-Tag: noindex

/assets/generated/*
  Cache-Control: public, max-age=300
`,
    });

    expect(result.errors).toEqual([
      expect.stringContaining(
        'keeps a public deployment out of search indexes',
      ),
    ]);
  });
  it('requires the Worker gate, its directory Worker and sign-in on a private deployment', async () => {
    const ungated = await createProject({ withoutGate: true });
    expect(
      (await validateRepositoryContent(testSyncContext(ungated))).errors.join(
        '\n',
      ),
    ).toContain(`with main ${PLATFORM_WORKERS.gate}`);

    const noDirectory = await createProject({ withoutDirectory: true });
    expect(
      (
        await validateRepositoryContent(testSyncContext(noDirectory))
      ).errors.join('\n'),
    ).toContain(
      `${PROJECT_LAYOUT.directoryWranglerConfigurationFile} is missing`,
    );

    const otherNamespace = await createProject({
      directoryNamespace: 'kv-other',
    });
    expect(
      (
        await validateRepositoryContent(testSyncContext(otherNamespace))
      ).errors.join('\n'),
    ).toContain(`${deployment.workerName}-directory`);

    const root = await createProject();
    const withoutSignIn = { ...testSiteConfiguration };
    delete (withoutSignIn as { signIn?: unknown }).signIn;
    expect(
      (
        await validateRepositoryContent(createSyncContext(root, withoutSignIn))
      ).errors.join('\n'),
    ).toContain('signIn.workspaceDomains');
  });

  it('refuses redirects the asset store would apply before the Worker judged a file', async () => {
    const root = await createProject();
    await writeFile(join(root, 'public', '_redirects'), '/x/ /y/ 302\n');
    expect(
      (await validateRepositoryContent(testSyncContext(root))).errors.join(
        '\n',
      ),
    ).toContain('public/_redirects is not allowed');
  });

  it('refuses a route the directory Worker would inherit', async () => {
    const root = await createProject();
    const path = join(root, PROJECT_LAYOUT.directoryWranglerConfigurationFile);
    const directory = JSON.parse(await readFile(path, 'utf8')) as Record<
      string,
      unknown
    >;
    await writeFile(
      path,
      JSON.stringify({
        ...directory,
        routes: [{ pattern: deployment.environments.production.hostname }],
      }),
    );
    expect(
      (await validateRepositoryContent(testSyncContext(root))).errors.join(
        '\n',
      ),
    ).toContain(`${deployment.workerName}-directory`);
  });

  it('requires the bindings, flag and schedule of the MCP server once it is on', async () => {
    const withMcp = parseSiteConfiguration({
      ...TEST_SITE_CONFIGURATION_INPUT,
      mcp: { enabled: true },
    });
    const root = await createProject();
    const errorsFor = async () =>
      (
        await validateRepositoryContent(createSyncContext(root, withMcp))
      ).errors.join('\n');
    expect(await errorsFor()).toContain(
      `the ${PLATFORM_WORKERS.oauthBinding} KV namespace`,
    );

    const path = join(root, PROJECT_LAYOUT.wranglerConfigurationFile);
    const wrangler = JSON.parse(await readFile(path, 'utf8')) as {
      env: { production: Record<string, unknown> };
    } & Record<string, unknown>;
    const production = wrangler.env.production;
    const complete = {
      ...wrangler,
      compatibility_flags: [PLATFORM_WORKERS.oauthCompatibilityFlag],
      triggers: { crons: [PLATFORM_WORKERS.publishSchedule] },
      env: {
        production: {
          ...production,
          // The state namespace is found by its binding, in any position.
          kv_namespaces: [
            { binding: PLATFORM_WORKERS.oauthBinding, id: 'kv-oauth' },
            { binding: PLATFORM_WORKERS.stateBinding, id: 'kv-production' },
          ],
          r2_buckets: [
            {
              binding: PLATFORM_WORKERS.documentsBinding,
              bucket_name: 'example-documents',
            },
          ],
          ai_search: [
            {
              binding: PLATFORM_WORKERS.searchBinding,
              instance_name: 'example-search',
            },
          ],
        },
      },
    };
    await writeFile(path, JSON.stringify(complete));
    expect(await errorsFor()).not.toContain(PLATFORM_WORKERS.oauthBinding);

    await writeFile(
      path,
      JSON.stringify({ ...complete, compatibility_flags: [] }),
    );
    expect(await errorsFor()).toContain(
      PLATFORM_WORKERS.oauthCompatibilityFlag,
    );

    const twoStates = structuredClone(complete);
    twoStates.env.production.kv_namespaces = [
      { binding: PLATFORM_WORKERS.stateBinding, id: 'kv-production' },
      { binding: PLATFORM_WORKERS.stateBinding, id: 'kv-other' },
    ];
    await writeFile(path, JSON.stringify(twoStates));
    expect(await errorsFor()).toContain(PLATFORM_WORKERS.oauthBinding);
  });

  it('gates a deployment whose production is public but another environment is private', async () => {
    const root = await createProject({ visibility: 'public' });
    const mixed = parseSiteConfiguration({
      ...TEST_SITE_CONFIGURATION_INPUT,
      deployment: {
        ...TEST_SITE_CONFIGURATION_INPUT.deployment,
        environments: {
          production: {
            ...TEST_SITE_CONFIGURATION_INPUT.deployment.environments.production,
            visibility: 'public',
          },
          staging: { url: 'https://docs-staging.example.com' },
        },
      },
    });
    expect(
      (
        await validateRepositoryContent(createSyncContext(root, mixed))
      ).errors.join('\n'),
    ).toContain(`with main ${PLATFORM_WORKERS.gate}`);
  });

  it('asks for the access map to be ignored by Git', async () => {
    const root = await createProject();
    await runCommand('git', ['init', '--quiet'], { cwd: root });
    expect(
      (await validateRepositoryContent(testSyncContext(root))).errors.join(
        '\n',
      ),
    ).toContain(`${PROJECT_LAYOUT.accessMapFile} is not ignored by Git`);
    await writeFile(join(root, '.gitignore'), '.ctcdocs/\n');
    expect(
      (await validateRepositoryContent(testSyncContext(root))).errors.join(
        '\n',
      ),
    ).not.toContain('is not ignored by Git');
  });
});

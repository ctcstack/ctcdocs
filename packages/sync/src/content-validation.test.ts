import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { PROJECT_LAYOUT } from '@ctcstack/ctcdocs-core';
import { afterEach, describe, expect, it } from 'vitest';

import { validateRepositoryContent } from './content-validation.js';
import {
  TEST_MARKDOWN_HEADER,
  testSiteConfiguration,
  testSyncContext,
} from './test-support/project-fixture.js';

const runCommand = promisify(execFile);
const { deployment } = testSiteConfiguration;
const temporaryDirectories: string[] = [];

const PROTECTED_HEADERS = `/*.md
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

interface FixtureOptions {
  robots?: string;
  headers?: string;
  gitleaks?: string;
  generatedName?: string;
  generatedContent?: string;
  routePattern?: string;
  workersDev?: boolean;
  extraEnvironment?: boolean;
  withoutCorpus?: boolean;
}

async function createProject(options: FixtureOptions = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'content-validation-'));
  temporaryDirectories.push(root);

  await mkdir(join(root, PROJECT_LAYOUT.publicDirectory), { recursive: true });
  await writeFile(
    join(root, PROJECT_LAYOUT.robotsFile),
    options.robots ?? 'User-agent: *\nDisallow: /\n',
  );
  await writeFile(
    join(root, PROJECT_LAYOUT.headersFile),
    options.headers ?? PROTECTED_HEADERS,
  );
  await writeFile(
    join(root, PROJECT_LAYOUT.gitleaksConfigurationFile),
    options.gitleaks ?? GITLEAKS_CONFIGURATION,
  );
  await writeFile(
    join(root, PROJECT_LAYOUT.wranglerConfigurationFile),
    JSON.stringify({
      name: deployment.workerName,
      workers_dev: options.workersDev ?? false,
      preview_urls: false,
      assets: {
        directory: './dist',
        not_found_handling: '404-page',
        html_handling: 'auto-trailing-slash',
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
        },
        ...(options.extraEnvironment
          ? { public: { workers_dev: true, preview_urls: true } }
          : {}),
      },
    }),
  );

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

async function validate(options: FixtureOptions = {}) {
  return validateRepositoryContent(
    testSyncContext(await createProject(options)),
  );
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
      expect.stringContaining('must carry a rule for /assets/generated/*'),
    ]);
  });

  it('rejects a secret-scanner exemption that Git actually tracks', async () => {
    const root = await createProject();
    await runCommand('git', ['init', '--quiet'], { cwd: root });
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

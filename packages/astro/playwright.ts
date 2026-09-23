/**
 * Playwright configurations a project calls rather than copies.
 *
 * The accessibility gate has to run in every deployment, not only in the
 * platform, so the suites ship inside this package and `testDir` points into
 * `node_modules`. Ports, reporters and web-server wiring stay platform-owned;
 * a project's config file is a single call.
 */
import { fileURLToPath } from 'node:url';

import {
  defineConfig,
  devices,
  type PlaywrightTestConfig,
} from '@playwright/test';
import { findProjectRoot, loadSiteConfiguration } from '@ctcstack/ctcdocs-core';

function suiteDirectory(name: 'ux' | 'e2e'): string {
  return fileURLToPath(new URL(`./tests/${name}`, import.meta.url));
}

/**
 * `ctcdocs-preview`, found through this package rather than a project's
 * `node_modules/.bin`, which is on `PATH` only when a package manager started
 * Playwright.
 */
const previewServer = fileURLToPath(
  new URL(
    'bin/preview.mjs',
    import.meta.resolve('@ctcstack/ctcdocs/package.json'),
  ),
);

/** Quotes one word for the shell Playwright runs `webServer.command` in. */
function shellWord(value: string): string {
  return process.platform === 'win32'
    ? `"${value}"`
    : `'${value.replaceAll("'", `'\\''`)}'`;
}

export interface UxConfigOptions {
  /** Port the preview server binds while the suite runs. */
  port?: number;
  /**
   * Command that serves the built site. Defaults to this package's
   * `ctcdocs-preview`, which stays in the foreground under an AI agent where
   * `astro preview` does not.
   */
  previewCommand?: string;
}

/**
 * The local gate: the build is served by Astro's preview server, and the suite
 * asserts accessibility and interface behavior against the corpus that project
 * has.
 */
export function defineUxConfig(
  options: UxConfigOptions = {},
): PlaywrightTestConfig {
  const port = options.port ?? 4323;
  const baseURL = `http://127.0.0.1:${port}`;

  return defineConfig({
    testDir: suiteDirectory('ux'),
    fullyParallel: true,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    ...(process.env.CI ? { workers: 1 } : {}),
    reporter: process.env.CI ? 'github' : 'list',
    projects: [
      {
        name: 'chromium',
        use: { ...devices['Desktop Chrome'] },
      },
    ],
    use: {
      baseURL,
      screenshot: 'off',
      // Traces of a protected site contain document content, so they are not
      // recorded here: the local gate reproduces failures by rerunning.
      trace: 'off',
      video: 'off',
    },
    webServer: {
      command:
        options.previewCommand ??
        `${shellWord(process.execPath)} ${shellWord(previewServer)} --host 127.0.0.1 --port ${port}`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      url: baseURL,
    },
  });
}

/**
 * The deployed gate: proves Cloudflare Access denies anonymous traffic and
 * admits a service token. It runs against a real hostname, so it takes the
 * project's production origin unless told otherwise.
 */
export function defineAccessConfig(): PlaywrightTestConfig {
  const site = loadSiteConfiguration(findProjectRoot());

  return defineConfig({
    testDir: suiteDirectory('e2e'),
    fullyParallel: true,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 2 : 0,
    ...(process.env.CI ? { workers: 1 } : {}),
    reporter: process.env.CI ? 'github' : 'list',
    use: {
      // `||` rather than `??`: an `.env` copied from `.env.example` leaves the
      // override defined but empty, which is not a target to point tests at.
      baseURL:
        process.env.CTCDOCS_BASE_URL ||
        site.deployment.environments.production.url,
      trace: 'retain-on-failure',
    },
  });
}

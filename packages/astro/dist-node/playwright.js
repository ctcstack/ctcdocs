/**
 * Playwright configurations a project calls rather than copies.
 *
 * The accessibility gate has to run in every deployment, not only in the
 * platform, so the suites ship inside this package and `testDir` points into
 * `node_modules`. Ports, reporters and web-server wiring stay platform-owned;
 * a project's config file is a single call.
 */
import { fileURLToPath } from 'node:url';
import { defineConfig, devices, } from '@playwright/test';
import { findProjectRoot, loadSiteConfiguration } from '@ctcstack/ctcdocs-core';
function suiteDirectory(name) {
    return fileURLToPath(new URL(`./tests/${name}`, import.meta.url));
}
/**
 * The local gate: builds are served from the project's own preview server, and
 * the suite asserts accessibility and interface behavior against the corpus
 * that project has.
 */
export function defineUxConfig(options = {}) {
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
            command: options.previewCommand ??
                `pnpm preview --host 127.0.0.1 --port ${port}`,
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
export function defineAccessConfig() {
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
            baseURL: process.env.CTCDOCS_BASE_URL ||
                site.deployment.environments.production.url,
            trace: 'retain-on-failure',
        },
    });
}

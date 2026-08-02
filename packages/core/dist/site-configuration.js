/**
 * The project configuration layer.
 *
 * Everything that identifies one deployment of this platform — the product
 * name, the hostnames it is served from, the Worker it deploys to, the marker
 * stamped into generated files — lives in the project's `site.config.json` and
 * is read from here. Adapting the platform to another project is editing that
 * one file plus the environment variables in `.env.example`; no source file,
 * test, or workflow in the platform carries a project name of its own.
 *
 * The values are validated rather than trusted, because a typo in a hostname is
 * the difference between a protected deployment and a public one.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROJECT_LAYOUT } from './project-layout.js';
export class SiteConfigurationError extends Error {
    name = 'SiteConfigurationError';
}
function fail(path, expectation) {
    throw new SiteConfigurationError(`${PROJECT_LAYOUT.configurationFile}: ${path} ${expectation}.`);
}
function record(value, path) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        fail(path, 'must be an object');
    }
    return value;
}
function text(source, key, path) {
    const value = source[key];
    if (typeof value !== 'string' || value.trim().length === 0) {
        fail(path, 'must be a non-empty string');
    }
    return value.trim();
}
/**
 * Accepts only a bare HTTPS origin. A path, query, or embedded credential
 * would silently produce wrong canonical URLs, wrong Wrangler routes, and a
 * smoke test that probes the wrong address.
 */
function origin(source, key, path) {
    const value = text(source, key, path);
    let url;
    try {
        url = new URL(value);
    }
    catch {
        return fail(path, 'must be an absolute URL');
    }
    if (url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !['', '/'].includes(url.pathname)) {
        fail(path, 'must be an HTTPS origin without credentials, path, or query');
    }
    return url;
}
/**
 * A list of distinct, non-empty titles. Two entries differing only in case
 * would make the precedence between them depend on which one a folder happens
 * to contain, so they are rejected rather than deduplicated.
 */
function titleList(source, key, path) {
    const value = source[key];
    if (!Array.isArray(value) || value.length === 0) {
        fail(path, 'must be a non-empty array of titles');
    }
    const titles = value.map((entry, index) => {
        if (typeof entry !== 'string' || entry.trim().length === 0) {
            fail(`${path}[${index}]`, 'must be a non-empty string');
        }
        return entry.trim();
    });
    const seen = new Set(titles.map((title) => title.toLocaleLowerCase('en')));
    if (seen.size !== titles.length) {
        fail(path, 'must not repeat a title');
    }
    return Object.freeze(titles);
}
function flag(source, key, path) {
    const value = source[key];
    if (typeof value !== 'boolean') {
        fail(path, 'must be true or false');
    }
    return value;
}
/**
 * Environment names become Wrangler environment keys and appear in Worker
 * names as `<worker>-<environment>`, so they are held to the same shape as the
 * Worker name itself.
 */
function environments(source) {
    const raw = record(source.environments, 'deployment.environments');
    const names = Object.keys(raw);
    if (!names.includes('production')) {
        fail('deployment.environments', 'must define a production environment');
    }
    const parsed = {};
    const hostnames = new Map();
    for (const name of names) {
        const path = `deployment.environments.${name}`;
        if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(name)) {
            fail(path, 'must be named with lowercase letters, digits, and hyphens');
        }
        const url = origin(record(raw[name], path), 'url', `${path}.url`);
        const previous = hostnames.get(url.host);
        if (previous !== undefined) {
            fail(path, `must not reuse the hostname already bound by the ${previous} environment`);
        }
        hostnames.set(url.host, name);
        parsed[name] = { hostname: url.host, url: url.origin };
    }
    return Object.freeze(parsed);
}
export function parseSiteConfiguration(input) {
    const root = record(input, 'the configuration');
    const brandSource = record(root.brand, 'brand');
    const faviconPath = text(brandSource, 'faviconPath', 'brand.faviconPath');
    if (!faviconPath.startsWith('/')) {
        fail('brand.faviconPath', 'must be a site-root-relative path');
    }
    const brand = {
        faviconPath,
        name: text(brandSource, 'name', 'brand.name'),
        siteDescription: text(brandSource, 'siteDescription', 'brand.siteDescription'),
        siteTitle: text(brandSource, 'siteTitle', 'brand.siteTitle'),
    };
    const deploymentSource = record(root.deployment, 'deployment');
    const workerName = text(deploymentSource, 'workerName', 'deployment.workerName');
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(workerName)) {
        fail('deployment.workerName', 'must be lowercase letters, digits, and hyphens');
    }
    const syncSource = record(root.sync, 'sync');
    const generatedBy = text(syncSource, 'generatedBy', 'sync.generatedBy');
    // The marker is embedded in an HTML comment in every generated Markdown
    // file. A comment delimiter inside it would terminate that comment early and
    // publish the rest of the marker as document text.
    if (generatedBy.includes('--') || generatedBy.includes('<')) {
        fail('sync.generatedBy', 'must not contain "--" or "<"');
    }
    const defaultLocale = text(syncSource, 'defaultLocale', 'sync.defaultLocale');
    if (defaultLocale.length < 2) {
        fail('sync.defaultLocale', 'must be a language tag such as "en"');
    }
    const navigationSource = record(root.navigation, 'navigation');
    const homeSource = record(root.home, 'home');
    return {
        brand,
        deployment: {
            environments: environments(deploymentSource),
            workerName,
        },
        home: { lede: text(homeSource, 'lede', 'home.lede') },
        navigation: {
            landingDocumentTitles: titleList(navigationSource, 'landingDocumentTitles', 'navigation.landingDocumentTitles'),
            sectionIndexPages: flag(navigationSource, 'sectionIndexPages', 'navigation.sectionIndexPages'),
        },
        sync: {
            commitBotName: text(syncSource, 'commitBotName', 'sync.commitBotName'),
            defaultLocale,
            generatedBy,
        },
    };
}
/**
 * Parsed configurations, keyed by absolute project root.
 *
 * The configuration is read by the Astro build, by every component that renders
 * during it, and by the sync CLI. Reading and validating the same file dozens of
 * times per build would be wasted work, and — more importantly — two components
 * disagreeing about the configuration because one of them read a half-written
 * file is a class of bug worth designing out.
 */
const loaded = new Map();
export function loadSiteConfiguration(projectRoot) {
    const root = resolve(projectRoot);
    const cached = loaded.get(root);
    if (cached) {
        return cached;
    }
    const configurationPath = resolve(root, PROJECT_LAYOUT.configurationFile);
    let raw;
    try {
        raw = JSON.parse(readFileSync(configurationPath, 'utf8'));
    }
    catch (error) {
        throw new SiteConfigurationError(`${configurationPath} could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }
    const configuration = parseSiteConfiguration(raw);
    loaded.set(root, configuration);
    return configuration;
}

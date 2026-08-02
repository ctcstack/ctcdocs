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

export interface BrandConfiguration {
  /** The organization or product the documentation belongs to. */
  readonly name: string;
  /** The site's own name: browser tab, header wordmark, home page heading. */
  readonly siteTitle: string;
  /** One sentence, used as the site-wide meta description. */
  readonly siteDescription: string;
  /** Site-root-relative path of the favicon served from `public/`. */
  readonly faviconPath: string;
}

export interface HomeConfiguration {
  /**
   * The paragraph under the home page heading: where the documents come from
   * and what a reader may do with them. It is whole prose rather than a name
   * the platform assembles a sentence around, because the sentence itself is
   * an editorial choice — how the Drive is named, whether read-only is worth
   * saying, what a newcomer needs first.
   */
  readonly lede: string;
}

/**
 * Who a deployment is for.
 *
 * `private` is a documentation site behind an identity boundary: crawlers are
 * refused, pages ask not to be indexed, responses are cached privately, and the
 * smoke test proves anonymous traffic is denied before anything is published.
 * `public` is a documentation portal anyone may read, and the same checks run
 * with their assertions inverted — a public site that has quietly become
 * unreachable is as much a defect as a private one that has quietly become
 * readable.
 *
 * It defaults to `private` because a wrong guess in that direction is
 * recoverable and a wrong guess in the other one is a disclosure.
 */
export type DeploymentVisibility = 'private' | 'public';

export interface DeploymentEnvironmentConfiguration {
  /** Origin the environment is served from, without a trailing path. */
  readonly url: string;
  /** Host of `url`, which is what a Wrangler custom-domain route binds. */
  readonly hostname: string;
  /** Who may read this environment. Defaults to `private`. */
  readonly visibility: DeploymentVisibility;
}

/**
 * Deployment environments, keyed by Wrangler environment name.
 *
 * A project decides how many it wants: one deployment may promote through a
 * development hostname, another may publish production only. `production` is
 * the one name the platform depends on — it is the canonical site address, the
 * origin the sync pipeline writes into generated links, and the target the
 * smoke tests default to — so it is required and every other name is the
 * project's own.
 */
export type DeploymentEnvironmentConfigurations = {
  readonly production: DeploymentEnvironmentConfiguration;
} & {
  readonly [environmentName: string]: DeploymentEnvironmentConfiguration;
};

export interface DeploymentConfiguration {
  /** Cloudflare Worker name; environments deploy as `<name>-<environment>`. */
  readonly workerName: string;
  readonly environments: DeploymentEnvironmentConfigurations;
}

export interface SyncConfigurationDefaults {
  /**
   * Named in the ownership marker of every generated file. Changing it
   * rewrites the marker in the whole generated corpus, so it is a deliberate
   * one-time decision for a new project rather than a cosmetic setting.
   */
  readonly generatedBy: string;
  /** Git author the sync workflow commits generated output as. */
  readonly commitBotName: string;
  /** Locale assumed for documents whose language cannot be determined. */
  readonly defaultLocale: string;
}

export interface NavigationConfiguration {
  /**
   * Document titles that open the folder they sit in, most preferred first.
   * Matched case-insensitively against the title a reader sees, so the order
   * prefix is not part of it.
   */
  readonly landingDocumentTitles: readonly string[];
  /**
   * Whether each folder gets a generated page listing its contents. Folder
   * slugs are reserved either way, so turning this on or off moves no address.
   */
  readonly sectionIndexPages: boolean;
}

export interface SiteConfiguration {
  readonly brand: BrandConfiguration;
  readonly deployment: DeploymentConfiguration;
  readonly home: HomeConfiguration;
  readonly navigation: NavigationConfiguration;
  readonly sync: SyncConfigurationDefaults;
}

export class SiteConfigurationError extends Error {
  override readonly name = 'SiteConfigurationError';
}

function fail(path: string, expectation: string): never {
  throw new SiteConfigurationError(
    `${PROJECT_LAYOUT.configurationFile}: ${path} ${expectation}.`,
  );
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, 'must be an object');
  }
  return value as Record<string, unknown>;
}

function text(
  source: Record<string, unknown>,
  key: string,
  path: string,
): string {
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
function origin(
  source: Record<string, unknown>,
  key: string,
  path: string,
): URL {
  const value = text(source, key, path);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail(path, 'must be an absolute URL');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['', '/'].includes(url.pathname)
  ) {
    fail(path, 'must be an HTTPS origin without credentials, path, or query');
  }
  return url;
}

/**
 * A list of distinct, non-empty titles. Two entries differing only in case
 * would make the precedence between them depend on which one a folder happens
 * to contain, so they are rejected rather than deduplicated.
 */
function titleList(
  source: Record<string, unknown>,
  key: string,
  path: string,
): readonly string[] {
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

function flag(
  source: Record<string, unknown>,
  key: string,
  path: string,
): boolean {
  const value = source[key];
  if (typeof value !== 'boolean') {
    fail(path, 'must be true or false');
  }
  return value;
}

function optionalVisibility(
  source: Record<string, unknown>,
  path: string,
): DeploymentVisibility {
  const value = source.visibility;
  if (value === undefined) {
    return 'private';
  }
  if (value !== 'private' && value !== 'public') {
    fail(`${path}.visibility`, 'must be "private" or "public"');
  }
  return value;
}

/**
 * Environment names become Wrangler environment keys and appear in Worker
 * names as `<worker>-<environment>`, so they are held to the same shape as the
 * Worker name itself.
 */
function environments(
  source: Record<string, unknown>,
): DeploymentEnvironmentConfigurations {
  const raw = record(source.environments, 'deployment.environments');
  const names = Object.keys(raw);
  if (!names.includes('production')) {
    fail('deployment.environments', 'must define a production environment');
  }

  const parsed: Record<string, DeploymentEnvironmentConfiguration> = {};
  const hostnames = new Map<string, string>();

  for (const name of names) {
    const path = `deployment.environments.${name}`;
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(name)) {
      fail(path, 'must be named with lowercase letters, digits, and hyphens');
    }
    const environmentSource = record(raw[name], path);
    const url = origin(environmentSource, 'url', `${path}.url`);
    const visibility = optionalVisibility(environmentSource, path);
    const previous = hostnames.get(url.host);
    if (previous !== undefined) {
      fail(
        path,
        `must not reuse the hostname already bound by the ${previous} environment`,
      );
    }
    hostnames.set(url.host, name);
    parsed[name] = { hostname: url.host, url: url.origin, visibility };
  }

  return Object.freeze(parsed) as DeploymentEnvironmentConfigurations;
}

export function parseSiteConfiguration(input: unknown): SiteConfiguration {
  const root = record(input, 'the configuration');

  const brandSource = record(root.brand, 'brand');
  const faviconPath = text(brandSource, 'faviconPath', 'brand.faviconPath');
  if (!faviconPath.startsWith('/')) {
    fail('brand.faviconPath', 'must be a site-root-relative path');
  }
  const brand: BrandConfiguration = {
    faviconPath,
    name: text(brandSource, 'name', 'brand.name'),
    siteDescription: text(
      brandSource,
      'siteDescription',
      'brand.siteDescription',
    ),
    siteTitle: text(brandSource, 'siteTitle', 'brand.siteTitle'),
  };

  const deploymentSource = record(root.deployment, 'deployment');
  const workerName = text(
    deploymentSource,
    'workerName',
    'deployment.workerName',
  );
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(workerName)) {
    fail(
      'deployment.workerName',
      'must be lowercase letters, digits, and hyphens',
    );
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
      landingDocumentTitles: titleList(
        navigationSource,
        'landingDocumentTitles',
        'navigation.landingDocumentTitles',
      ),
      sectionIndexPages: flag(
        navigationSource,
        'sectionIndexPages',
        'navigation.sectionIndexPages',
      ),
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
const loaded = new Map<string, SiteConfiguration>();

export function loadSiteConfiguration(projectRoot: string): SiteConfiguration {
  const root = resolve(projectRoot);
  const cached = loaded.get(root);
  if (cached) {
    return cached;
  }

  const configurationPath = resolve(root, PROJECT_LAYOUT.configurationFile);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configurationPath, 'utf8'));
  } catch (error: unknown) {
    throw new SiteConfigurationError(
      `${configurationPath} could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const configuration = parseSiteConfiguration(raw);
  loaded.set(root, configuration);
  return configuration;
}

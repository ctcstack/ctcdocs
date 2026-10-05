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

import {
  parseAccessConfiguration,
  type AccessConfiguration,
} from './access-configuration.js';
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
  /**
   * How many documents the "recently updated" band lists. The band answers
   * "what moved since I last looked", and how far back that reaches is a
   * property of the corpus: a wiki synchronizing a handful of documents a week
   * needs a shorter list than one where a dozen change a day. Defaults to 6.
   */
  readonly recentLimit: number;
  /**
   * Whether the home page ends with the full index of every document, grouped
   * by folder. Defaults to `true`. The index is published either way, at the
   * address in `PLATFORM_ROUTES.fullIndex`; this decides only whether the home
   * page carries a copy of it or links to it. A deployment whose corpus has
   * outgrown one page may prefer the home page to stay an entrance.
   */
  readonly corpusIndex: boolean;
  /**
   * The address of the hand-authored page the home page sends a newcomer to,
   * as a slug: `about` for `src/content/docs/about.md`. The link reads that
   * page's own title, so renaming the page renames the link. Without it the
   * home page offers no such link: the platform does not know what a
   * deployment calls its introduction, or whether it has one.
   */
  readonly start?: string;
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
  /**
   * The size, in megabytes of a million bytes, above which the sync report
   * notes a published image. What is too large is not settled yet, so a
   * project sets the line it wants numbers for. Defaults to 2.
   */
  readonly largeImageMegabytes: number;
  /**
   * The length, in characters of a document's Markdown body, above which the
   * sync report notes the document as worth splitting (ADR-043). No greater
   * than the characters an assistant reads of a document; defaults to 40,000,
   * or to that limit where it is lower.
   */
  readonly largeDocumentCharacters: number;
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
  /**
   * The Unicode scripts a letter in a Drive name may belong to, such as
   * `["Latin"]`, or `null` when any script is accepted. A name becomes a
   * heading, a sidebar label and, once, a permanent address, so a deployment
   * whose editors write in one alphabet can refuse a letter typed on the other
   * keyboard layout before it reaches any of them. Whatever this allows, a
   * single word never mixes Latin, Cyrillic and Greek letters (ADR-020).
   */
  readonly nameScripts: readonly string[] | null;
  /**
   * Whether an address stays where it was first given (`stable`, ADR-005) or
   * follows its item's current Drive path on every sync over the whole corpus
   * (`follow-names`, ADR-021). Either way a moved address leaves a redirect,
   * so a project can switch while its structure settles and back once people
   * share links. Defaults to `stable`.
   */
  readonly addresses: AddressPolicy;
}

export type AddressPolicy = 'stable' | 'follow-names';

/**
 * How a private deployment signs readers in (ADR-038): with Google, admitting
 * only accounts whose `hd` is one of these Workspace domains. An organization
 * with secondary domains lists each, since `hd` names the domain of a
 * reader's own primary address.
 */
export interface SignInConfiguration {
  readonly workspaceDomains: readonly string[];
}

/**
 * How the MCP server searches and how much a search returns (ADR-042). Every
 * value has a default, the starting point ADR-042 records, so that a project
 * tunes it against its own corpus without a new version of the platform.
 */
export interface McpSearchConfiguration {
  /** Chunks asked of AI Search for each query: 1 to 50. */
  readonly chunks: number;
  /**
   * The vector similarity below which AI Search drops a chunk, 0 to 1. It
   * drops only chunks vector search alone found, and AI Search ignores it
   * while reranking is on (ADR-042), so it acts only with reranking off.
   */
  readonly vectorThreshold: number;
  /** Whether a keyword match needs every word of the query, or any. */
  readonly keywordMatch: 'and' | 'or';
  /**
   * Neighbouring chunks AI Search joins to each side of a match: 0 to 3. A
   * chunk of AI Search's default size is already longer than a passage.
   */
  readonly contextChunks: number;
  readonly reranking: {
    readonly enabled: boolean;
    /** An AI Search reranking model. */
    readonly model: string;
    /** The reranking score below which a chunk is dropped, 0 to 1. */
    readonly threshold: number;
  };
  /** Documents a search returns at most; no more than `chunks`. */
  readonly results: number;
  /** Passages each document shows at most. */
  readonly passagesPerResult: number;
  /** Characters of passage text one search returns at most, in all. */
  readonly passageCharacters: number;
}

/** What `recent` lists (ADR-044). */
export interface McpRecentConfiguration {
  /** Documents it lists when a call does not ask for a number. */
  readonly defaultResults: number;
  /** Documents a call may ask for at most. */
  readonly results: number;
}

/**
 * The MCP server through which AI assistants read the site as the person who
 * connected them (ADR-041). It needs the Worker's sign-in, so it is accepted
 * only on a deployment whose every environment is private.
 */
export interface McpConfiguration {
  readonly enabled: boolean;
  readonly search: McpSearchConfiguration;
  /** Characters `fetch` returns at most; a longer document is cut there. */
  readonly fetchCharacters: number;
  /** Characters of JSON a `browse` tree takes at most (ADR-044). */
  readonly browseCharacters: number;
  readonly recent: McpRecentConfiguration;
}

/** What `mcp` holds when a project sets only `enabled` (ADR-042). */
export const MCP_DEFAULTS: Omit<McpConfiguration, 'enabled'> = Object.freeze({
  search: Object.freeze({
    chunks: 50,
    vectorThreshold: 0.2,
    keywordMatch: 'or',
    contextChunks: 0,
    reranking: Object.freeze({
      enabled: true,
      model: '@cf/baai/bge-reranker-base',
      threshold: 0,
    }),
    results: 15,
    passagesPerResult: 3,
    passageCharacters: 24_000,
  }),
  fetchCharacters: 100_000,
  browseCharacters: 24_000,
  recent: Object.freeze({ defaultResults: 20, results: 50 }),
});

/**
 * The characters an assistant reads of a document: the cut `fetch` makes
 * (ADR-042), or its default while the MCP server is off. The build writes
 * this value into the access map and the sync measures documents against it
 * (ADR-043), so the two never derive it apart.
 */
export function fetchCharacterLimit(mcp: McpConfiguration | undefined): number {
  return mcp?.enabled ? mcp.fetchCharacters : MCP_DEFAULTS.fetchCharacters;
}

/** About 10,000 tokens of English: a starting value, not a measured one. */
const LARGE_DOCUMENT_CHARACTERS = 40_000;

/** A passage of fewer characters than this says too little to judge by. */
const SHORTEST_PASSAGE = 100;

export interface SiteConfiguration {
  /** Required to serve a private environment through the platform's Worker. */
  readonly signIn?: SignInConfiguration;
  /** Absent or disabled, the Worker serves no MCP or OAuth route. */
  readonly mcp?: McpConfiguration;
  /**
   * Who may read which folder (ADR-039). Absent, every document is open to
   * every reader the deployment admits, as before access rules existed.
   */
  readonly access?: AccessConfiguration;
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

function optionalFlag(
  source: Record<string, unknown>,
  key: string,
  path: string,
  fallback: boolean,
): boolean {
  return source[key] === undefined ? fallback : flag(source, key, path);
}

/**
 * A page's address as Starlight derives it from a file under
 * `src/content/docs`: lowercase segments joined by `/`, with no leading or
 * trailing slash, so it is the same string the content collection knows.
 */
function optionalPageSlug(
  source: Record<string, unknown>,
  key: string,
  path: string,
): Record<string, string> {
  if (source[key] === undefined) {
    return {};
  }
  const value = text(source, key, path);
  if (!/^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*$/u.test(value)) {
    fail(
      path,
      'must be a page address such as "about", without slashes at either end',
    );
  }
  return { [key]: value };
}

/**
 * A list of distinct Unicode script names, as a `\p{Script=…}` property
 * escape spells them. Each name is proved by compiling that escape, so a typo
 * fails here rather than letting every letter through, or none.
 */
function optionalScriptList(
  source: Record<string, unknown>,
  key: string,
  path: string,
): readonly string[] | null {
  const value = source[key];
  if (value === undefined) {
    return null;
  }
  if (!Array.isArray(value) || value.length === 0) {
    fail(path, 'must be a non-empty array of Unicode script names');
  }
  const scripts = value.map((entry, index) => {
    if (typeof entry !== 'string' || !/^[A-Za-z_]+$/u.test(entry)) {
      fail(
        `${path}[${index}]`,
        'must be a Unicode script name such as "Latin"',
      );
    }
    try {
      new RegExp(`\\p{Script=${entry}}`, 'u');
    } catch {
      fail(
        `${path}[${index}]`,
        'must be a Unicode script name such as "Latin"',
      );
    }
    return entry;
  });
  if (new Set(scripts).size !== scripts.length) {
    fail(path, 'must not repeat a script');
  }
  return Object.freeze(scripts);
}

/**
 * A count of things shown on a page. Zero is rejected along with fractions and
 * negatives: a block configured to show nothing is hidden by the switch that
 * hides it, not by a limit that leaves an empty heading behind.
 */
function optionalCount(
  source: Record<string, unknown>,
  key: string,
  path: string,
  fallback: number,
): number {
  const value = source[key];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    fail(path, 'must be a whole number of at least 1');
  }
  return value;
}

/** A size above zero, in megabytes; a fraction such as 1.5 is allowed. */
/** A number between `min` and `max`, whole when `whole`, or the fallback. */
function optionalNumber(
  source: Record<string, unknown>,
  key: string,
  path: string,
  fallback: number,
  { min, max, whole }: { min: number; max?: number; whole: boolean },
): number {
  const value = source[key];
  if (value === undefined) {
    return fallback;
  }
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    (whole && !Number.isInteger(value)) ||
    value < min ||
    (max !== undefined && value > max)
  ) {
    const kind = whole ? 'a whole number' : 'a number';
    fail(
      path,
      max === undefined
        ? `must be ${kind} of at least ${min}`
        : `must be ${kind} from ${min} to ${max}`,
    );
  }
  return value;
}

/** Fails on a key the section does not define. */
function knownKeys(
  source: Record<string, unknown>,
  path: string,
  keys: readonly string[],
): void {
  for (const key of Object.keys(source)) {
    if (!keys.includes(key)) {
      fail(`${path}.${key}`, 'is not a known setting');
    }
  }
}

function mcpSearch(value: unknown): McpSearchConfiguration {
  const defaults = MCP_DEFAULTS.search;
  if (value === undefined) {
    return defaults;
  }
  const source = record(value, 'mcp.search');
  knownKeys(source, 'mcp.search', Object.keys(defaults));
  const chunks = optionalNumber(
    source,
    'chunks',
    'mcp.search.chunks',
    defaults.chunks,
    {
      min: 1,
      max: 50,
      whole: true,
    },
  );
  const keywordMatch = source.keywordMatch ?? defaults.keywordMatch;
  if (keywordMatch !== 'and' && keywordMatch !== 'or') {
    fail('mcp.search.keywordMatch', 'must be "and" or "or"');
  }
  let reranking = defaults.reranking;
  if (source.reranking !== undefined) {
    const rerankingSource = record(source.reranking, 'mcp.search.reranking');
    knownKeys(rerankingSource, 'mcp.search.reranking', Object.keys(reranking));
    reranking = {
      enabled: optionalFlag(
        rerankingSource,
        'enabled',
        'mcp.search.reranking.enabled',
        reranking.enabled,
      ),
      model:
        rerankingSource.model === undefined
          ? reranking.model
          : text(rerankingSource, 'model', 'mcp.search.reranking.model'),
      threshold: optionalNumber(
        rerankingSource,
        'threshold',
        'mcp.search.reranking.threshold',
        reranking.threshold,
        { min: 0, max: 1, whole: false },
      ),
    };
  }
  // The default, like a set value, is no more than the chunks asked for.
  const results = optionalNumber(
    source,
    'results',
    'mcp.search.results',
    Math.min(defaults.results, chunks),
    { min: 1, max: chunks, whole: true },
  );
  return {
    chunks,
    vectorThreshold: optionalNumber(
      source,
      'vectorThreshold',
      'mcp.search.vectorThreshold',
      defaults.vectorThreshold,
      { min: 0, max: 1, whole: false },
    ),
    keywordMatch,
    contextChunks: optionalNumber(
      source,
      'contextChunks',
      'mcp.search.contextChunks',
      defaults.contextChunks,
      { min: 0, max: 3, whole: true },
    ),
    reranking,
    results,
    passagesPerResult: optionalNumber(
      source,
      'passagesPerResult',
      'mcp.search.passagesPerResult',
      defaults.passagesPerResult,
      { min: 1, whole: true },
    ),
    passageCharacters: optionalNumber(
      source,
      'passageCharacters',
      'mcp.search.passageCharacters',
      defaults.passageCharacters,
      { min: results * SHORTEST_PASSAGE, whole: true },
    ),
  };
}

function mcpRecent(value: unknown): McpRecentConfiguration {
  const defaults = MCP_DEFAULTS.recent;
  if (value === undefined) {
    return defaults;
  }
  const source = record(value, 'mcp.recent');
  knownKeys(source, 'mcp.recent', Object.keys(defaults));
  const results = optionalNumber(
    source,
    'results',
    'mcp.recent.results',
    defaults.results,
    { min: 1, whole: true },
  );
  // The default, like a set value, is no more than a call may ask for.
  return {
    defaultResults: optionalNumber(
      source,
      'defaultResults',
      'mcp.recent.defaultResults',
      Math.min(defaults.defaultResults, results),
      { min: 1, max: results, whole: true },
    ),
    results,
  };
}

function optionalMegabytes(
  source: Record<string, unknown>,
  key: string,
  path: string,
  fallback: number,
): number {
  const value = source[key];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    fail(path, 'must be a number of megabytes above 0');
  }
  return value;
}

function optionalAddressPolicy(
  source: Record<string, unknown>,
  key: string,
  path: string,
): AddressPolicy {
  const value = source[key];
  if (value === undefined) {
    return 'stable';
  }
  if (value !== 'stable' && value !== 'follow-names') {
    fail(path, 'must be "stable" or "follow-names"');
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
  // A misspelled optional line would otherwise fall back to its default.
  knownKeys(syncSource, 'sync', [
    'generatedBy',
    'commitBotName',
    'defaultLocale',
    'largeImageMegabytes',
    'largeDocumentCharacters',
  ]);
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
  const deployment: DeploymentConfiguration = {
    environments: environments(deploymentSource),
    workerName,
  };

  const publicEnvironment = Object.entries(deployment.environments).find(
    ([, environment]) => environment.visibility === 'public',
  );

  /*
   * Rules close folders to some readers, which a public environment cannot
   * do: everyone may read it. Accepting rules there would promise a boundary
   * that does not exist.
   */
  let access: AccessConfiguration | undefined;
  if (root.access !== undefined) {
    if (publicEnvironment) {
      fail(
        'access',
        `must not be set while the ${publicEnvironment[0]} environment is public`,
      );
    }
    access = parseAccessConfiguration(root.access, fail);
  }

  let signIn: SignInConfiguration | undefined;
  if (root.signIn !== undefined) {
    const source = record(root.signIn, 'signIn');
    for (const key of Object.keys(source)) {
      if (key !== 'workspaceDomains') {
        fail(`signIn.${key}`, 'is not a known setting');
      }
    }
    const domains = source.workspaceDomains;
    if (!Array.isArray(domains) || domains.length === 0) {
      fail('signIn.workspaceDomains', 'must be a non-empty array of domains');
    }
    const parsed = domains.map((domain: unknown, index: number) => {
      const value =
        typeof domain === 'string' ? domain.trim().toLowerCase() : '';
      if (
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/u.test(
          value,
        )
      ) {
        fail(
          `signIn.workspaceDomains[${index}]`,
          'must be a domain such as "example.com"',
        );
      }
      return value;
    });
    if (new Set(parsed).size !== parsed.length) {
      fail('signIn.workspaceDomains', 'must not repeat a domain');
    }
    signIn = { workspaceDomains: Object.freeze(parsed) };
  }

  let mcp: McpConfiguration | undefined;
  if (root.mcp !== undefined) {
    const source = record(root.mcp, 'mcp');
    knownKeys(source, 'mcp', [
      'enabled',
      'search',
      'fetchCharacters',
      'browseCharacters',
      'recent',
    ]);
    const enabled = flag(source, 'enabled', 'mcp.enabled');
    if (enabled) {
      if (!signIn) {
        fail('mcp', 'needs signIn: assistants sign in as the site does');
      }
      if (publicEnvironment) {
        fail(
          'mcp',
          `must not be enabled while the ${publicEnvironment[0]} environment is public`,
        );
      }
    }
    mcp = {
      enabled,
      search: mcpSearch(source.search),
      fetchCharacters: optionalNumber(
        source,
        'fetchCharacters',
        'mcp.fetchCharacters',
        MCP_DEFAULTS.fetchCharacters,
        { min: 1_000, whole: true },
      ),
      browseCharacters: optionalNumber(
        source,
        'browseCharacters',
        'mcp.browseCharacters',
        MCP_DEFAULTS.browseCharacters,
        { min: 1_000, whole: true },
      ),
      recent: mcpRecent(source.recent),
    };
  }
  const fetchLimit = fetchCharacterLimit(mcp);

  return {
    ...(signIn ? { signIn } : {}),
    ...(mcp ? { mcp } : {}),
    ...(access ? { access } : {}),
    brand,
    deployment,
    home: {
      corpusIndex: optionalFlag(
        homeSource,
        'corpusIndex',
        'home.corpusIndex',
        true,
      ),
      lede: text(homeSource, 'lede', 'home.lede'),
      recentLimit: optionalCount(
        homeSource,
        'recentLimit',
        'home.recentLimit',
        6,
      ),
      ...optionalPageSlug(homeSource, 'start', 'home.start'),
    },
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
      nameScripts: optionalScriptList(
        navigationSource,
        'nameScripts',
        'navigation.nameScripts',
      ),
      addresses: optionalAddressPolicy(
        navigationSource,
        'addresses',
        'navigation.addresses',
      ),
    },
    sync: {
      commitBotName: text(syncSource, 'commitBotName', 'sync.commitBotName'),
      defaultLocale,
      generatedBy,
      largeImageMegabytes: optionalMegabytes(
        syncSource,
        'largeImageMegabytes',
        'sync.largeImageMegabytes',
        2,
      ),
      largeDocumentCharacters: optionalNumber(
        syncSource,
        'largeDocumentCharacters',
        'sync.largeDocumentCharacters',
        Math.min(LARGE_DOCUMENT_CHARACTERS, fetchLimit),
        { min: 1, max: fetchLimit, whole: true },
      ),
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

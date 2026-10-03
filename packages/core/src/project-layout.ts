/**
 * Where a CTCDocs project keeps its files.
 *
 * The layout is a fixed convention rather than configuration, and deliberately
 * so: the generated-path allowlist below is a security control. Sync automation
 * fails when it writes outside it, and an allowlist a project can widen is an
 * allowlist an attacker can widen. A project that wants a different shape forks
 * the platform; it does not get a setting.
 *
 * Every path is repository-relative and POSIX-separated, because they are
 * compared against Git paths and written into the manifest.
 */
export const PROJECT_LAYOUT = {
  /** Identifies a project root; `findProjectRoot` walks up looking for it. */
  configurationFile: 'site.config.json',
  /** Deployment target. Wrangler reads it itself, so it cannot be generated. */
  wranglerConfigurationFile: 'wrangler.jsonc',
  /**
   * The scheduled Worker that keeps the directory snapshot of a private
   * deployment (ADR-040), deployed beside the site's own Worker.
   */
  directoryWranglerConfigurationFile: 'wrangler.directory.jsonc',
  /** Secret-scanning configuration, whose exemptions `validate` checks. */
  gitleaksConfigurationFile: '.gitleaks.toml',
  /** Served verbatim by the Worker. */
  publicDirectory: 'public',
  robotsFile: 'public/robots.txt',
  headersFile: 'public/_headers',
  /** Generated Markdown, one directory per Drive folder. */
  generatedDocumentsDirectory: 'src/content/docs/_generated',
  /** Original images, one directory per Google file identifier. */
  generatedAssetsDirectory: 'src/assets/generated',
  /** Generated TypeScript: the sidebar and the redirect map. */
  generatedSourceDirectory: 'src/generated',
  manifestFile: 'data/sync-manifest.json',
  documentIndexFile: 'data/docs-index.json',
  syncReportFile: 'data/latest-sync-report.json',
  /** What each document's opening says about its title (ADR-023). */
  titleReportFile: 'data/title-report.json',
  /**
   * Which access class every built file belongs to (ADR-039). Written by the
   * build outside `dist`, so it is never published, and read by the Worker.
   */
  accessMapFile: '.ctcdocs/access-map.json',
} as const;

/**
 * Addresses the platform serves itself.
 *
 * The corpus and the platform share one URL namespace, so a page the platform
 * injects is an address no document or folder may be allocated — a document
 * that claimed it would be silently shadowed by the route rather than fail
 * loudly. Slug allocation reserves these the way it reserves folder slugs (see
 * docs/ADR/014-section-index-pages.md) and validation refuses generated output
 * that claims one.
 *
 * The home page is not here: `/` is not a slug any document can be allocated.
 */
export const PLATFORM_ROUTES = {
  /** The whole corpus, grouped by folder. See docs/ADR/017-full-index-page.md. */
  fullIndex: 'documents',
  /**
   * Permanent links, `/d/<short ID>/`, one per document and section. See
   * docs/ADR/022-permanent-short-ids.md.
   */
  permanentLinks: 'd',
  /**
   * What editors have to fix, grouped by action. See
   * docs/ADR/024-content-health-page.md.
   */
  contentHealth: 'content-health',
} as const;

/**
 * The platform's Workers, as a project's Wrangler configuration names them
 * (ADR-038, ADR-040), and the alias under which they import the build's
 * access map.
 */
export const PLATFORM_WORKERS = {
  gate: 'node_modules/@ctcstack/ctcdocs/worker/index.ts',
  directory: 'node_modules/@ctcstack/ctcdocs/worker/directory/index.ts',
  accessMapAlias: 'ctcdocs-access-map',
  stateBinding: 'KB_STATE',
  directorySchedule: '*/10 * * * *',
  /** The MCP server's OAuth state; the library requires this name (ADR-041). */
  oauthBinding: 'OAUTH_KV',
  /** The R2 bucket the Worker publishes each document's Markdown to. */
  documentsBinding: 'KB_DOCUMENTS',
  /** The AI Search instance that indexes that bucket. */
  searchBinding: 'KB_SEARCH',
  /** How often the site's Worker checks that the bucket matches its build. */
  publishSchedule: '*/5 * * * *',
  /** Lets the OAuth library fetch a client's metadata document safely. */
  oauthCompatibilityFlag: 'global_fetch_strictly_public',
} as const;

/**
 * Where the Worker tells a signed-in reader which search bundles, beyond the
 * members bundle, they may open (ADR-039). Answered `{ "bundles": [...] }`.
 */
export const ACCESS_CLASSES_ROUTE = '/_kb/classes';

/** Each platform route as the href a link uses. */
export const PLATFORM_ROUTE_HREFS = {
  fullIndex: `/${PLATFORM_ROUTES.fullIndex}/`,
  contentHealth: `/${PLATFORM_ROUTES.contentHealth}/`,
} as const;

/**
 * Top-level addresses the platform serves beside the corpus: the Worker's
 * sign-in and OAuth routes (ADR-038, ADR-041), the search bundles,
 * `/pagefind/` and `/pagefind-<class>/` (ADR-039), and the original files
 * under `/assets/`. The MCP server needs none: it answers `/mcp` exactly
 * (ADR-041), and a page is always served under its trailing slash.
 */
const SERVED_ADDRESSES = ['auth', 'pagefind', 'assets'] as const;

export const RESERVED_SLUGS: readonly string[] = Object.freeze([
  ...Object.values(PLATFORM_ROUTES),
  ...SERVED_ADDRESSES,
]);

/**
 * A short ID: lowercase hexadecimal, six characters unless six collided with
 * another item's, in which case it is longer. It is recorded once per item and
 * never changes, so a permanent link keeps working through every rename.
 */
export const SHORT_ID_PATTERN = /^[0-9a-f]{6,64}$/u;

/** The site-relative permanent link of an item with this short ID. */
export function permanentLinkPath(shortId: string): string {
  return `/${PLATFORM_ROUTES.permanentLinks}/${shortId}/`;
}

export const GENERATED_DIRECTORY_ALLOWLIST = [
  PROJECT_LAYOUT.generatedDocumentsDirectory,
  PROJECT_LAYOUT.generatedAssetsDirectory,
  PROJECT_LAYOUT.generatedSourceDirectory,
] as const;

export const GENERATED_FILE_ALLOWLIST = [
  PROJECT_LAYOUT.manifestFile,
  PROJECT_LAYOUT.documentIndexFile,
  PROJECT_LAYOUT.syncReportFile,
  PROJECT_LAYOUT.titleReportFile,
] as const;

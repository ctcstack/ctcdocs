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
} as const;

/** Each platform route as the href a link uses. */
export const PLATFORM_ROUTE_HREFS = {
  fullIndex: `/${PLATFORM_ROUTES.fullIndex}/`,
} as const;

export const RESERVED_SLUGS: readonly string[] = Object.freeze(
  Object.values(PLATFORM_ROUTES),
);

export const GENERATED_DIRECTORY_ALLOWLIST = [
  PROJECT_LAYOUT.generatedDocumentsDirectory,
  PROJECT_LAYOUT.generatedAssetsDirectory,
  PROJECT_LAYOUT.generatedSourceDirectory,
] as const;

export const GENERATED_FILE_ALLOWLIST = [
  PROJECT_LAYOUT.manifestFile,
  PROJECT_LAYOUT.documentIndexFile,
  PROJECT_LAYOUT.syncReportFile,
] as const;

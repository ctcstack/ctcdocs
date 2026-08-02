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
};
export const GENERATED_DIRECTORY_ALLOWLIST = [
    PROJECT_LAYOUT.generatedDocumentsDirectory,
    PROJECT_LAYOUT.generatedAssetsDirectory,
    PROJECT_LAYOUT.generatedSourceDirectory,
];
export const GENERATED_FILE_ALLOWLIST = [
    PROJECT_LAYOUT.manifestFile,
    PROJECT_LAYOUT.documentIndexFile,
    PROJECT_LAYOUT.syncReportFile,
];

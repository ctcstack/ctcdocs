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
export declare const PROJECT_LAYOUT: {
    /** Identifies a project root; `findProjectRoot` walks up looking for it. */
    readonly configurationFile: "site.config.json";
    /** Deployment target. Wrangler reads it itself, so it cannot be generated. */
    readonly wranglerConfigurationFile: "wrangler.jsonc";
    /** Secret-scanning configuration, whose exemptions `validate` checks. */
    readonly gitleaksConfigurationFile: ".gitleaks.toml";
    /** Served verbatim by the Worker. */
    readonly publicDirectory: "public";
    readonly robotsFile: "public/robots.txt";
    readonly headersFile: "public/_headers";
    /** Generated Markdown, one directory per Drive folder. */
    readonly generatedDocumentsDirectory: "src/content/docs/_generated";
    /** Original images, one directory per Google file identifier. */
    readonly generatedAssetsDirectory: "src/assets/generated";
    /** Generated TypeScript: the sidebar and the redirect map. */
    readonly generatedSourceDirectory: "src/generated";
    readonly manifestFile: "data/sync-manifest.json";
    readonly documentIndexFile: "data/docs-index.json";
    readonly syncReportFile: "data/latest-sync-report.json";
};
export declare const GENERATED_DIRECTORY_ALLOWLIST: readonly ["src/content/docs/_generated", "src/assets/generated", "src/generated"];
export declare const GENERATED_FILE_ALLOWLIST: readonly ["data/sync-manifest.json", "data/docs-index.json", "data/latest-sync-report.json"];

export declare class ProjectRootError extends Error {
    readonly name = "ProjectRootError";
}
/**
 * The nearest ancestor of `from` that holds `site.config.json`, `from`
 * included. Defaults to the working directory, which is the project root for
 * `astro build`, for `ctcdocs-sync`, and for every script a project's
 * `package.json` runs.
 */
export declare function findProjectRoot(from?: string): string;

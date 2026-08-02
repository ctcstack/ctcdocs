/**
 * The project a sync run is acting on.
 *
 * The pipeline lives in `node_modules` of a project it knows nothing about, so
 * every run is told explicitly where that project is and what it is called.
 * Passing one object rather than a root path plus three derived strings keeps
 * the alternative — a module-level constant read at import time — off the
 * table: two projects can share this package inside one process, and a test
 * must be able to point a run at a temporary directory.
 */
import {
  findProjectRoot,
  generatedMarkdownHeader,
  generatedSourceHeader,
  loadSiteConfiguration,
  type SiteConfiguration,
} from '@ctcstack/ctcdocs-core';

export interface SyncContext {
  /** Absolute path of the project root: the directory holding the configuration. */
  readonly repositoryRoot: string;
  readonly site: SiteConfiguration;
  /** Ownership marker for generated Markdown, derived from `sync.generatedBy`. */
  readonly markdownHeader: string;
  /** Ownership marker for generated TypeScript sources. */
  readonly sourceHeader: string;
}

export function createSyncContext(
  repositoryRoot: string,
  site: SiteConfiguration,
): SyncContext {
  return {
    markdownHeader: generatedMarkdownHeader(site),
    repositoryRoot,
    site,
    sourceHeader: generatedSourceHeader(site),
  };
}

/**
 * The context for the project the process is running inside, which is what
 * every command line entry point wants: the working directory is the project
 * root for `ctcdocs-sync`, for `astro build`, and for every script a project's
 * `package.json` runs.
 */
export function loadSyncContext(from?: string): SyncContext {
  const repositoryRoot = findProjectRoot(from);
  return createSyncContext(
    repositoryRoot,
    loadSiteConfiguration(repositoryRoot),
  );
}

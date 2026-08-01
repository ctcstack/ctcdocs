/**
 * Finding the project a platform package is running inside.
 *
 * The platform packages live in `node_modules` of a project they know nothing
 * about. The CLI, the Astro components, and the browser suite all need the
 * project's root — to read its configuration, to resolve generated output, to
 * point Playwright at a corpus — and none of them can be told where it is by a
 * relative path from their own file.
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { PROJECT_LAYOUT } from './project-layout.js';

export class ProjectRootError extends Error {
  override readonly name = 'ProjectRootError';
}

/**
 * The nearest ancestor of `from` that holds `site.config.json`, `from`
 * included. Defaults to the working directory, which is the project root for
 * `astro build`, for `ctcdocs-sync`, and for every script a project's
 * `package.json` runs.
 */
export function findProjectRoot(from: string = process.cwd()): string {
  let directory = resolve(from);

  for (;;) {
    if (existsSync(resolve(directory, PROJECT_LAYOUT.configurationFile))) {
      return directory;
    }
    const parent = dirname(directory);
    if (parent === directory) {
      throw new ProjectRootError(
        `No ${PROJECT_LAYOUT.configurationFile} found in ${resolve(from)} or any parent directory. Run this from inside a CTCDocs project.`,
      );
    }
    directory = parent;
  }
}

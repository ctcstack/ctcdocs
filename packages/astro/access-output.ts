/**
 * The step after an Astro build that writes the search bundles per access
 * class and the access map (ADR-039). Private to the preset, like the route
 * injection; projects never name it.
 */
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import type { AstroIntegration } from 'astro';

import { accessMapPath, writeBuildOutput } from './lib/build-output.js';

export function ctcdocsAccessOutput(): AstroIntegration {
  let projectRoot = process.cwd();
  return {
    name: '@ctcstack/ctcdocs/access-output',
    hooks: {
      'astro:config:done': ({ config }) => {
        projectRoot = fileURLToPath(config.root);
      },
      /*
       * A map left by an earlier build must never be paired with new files,
       * so it goes before anything is built; a failed build leaves none.
       */
      'astro:build:start': async () => {
        await rm(accessMapPath(projectRoot), { force: true });
      },
      'astro:build:done': async ({ dir, logger }) => {
        const summary = await writeBuildOutput({
          projectRoot,
          distRoot: fileURLToPath(dir),
          warn: (message) => logger.warn(message),
        });
        logger.info(
          `Access map written: ${summary.files} files in ${summary.classes} classes; search pages by class ${JSON.stringify(summary.bundles)}.`,
        );
      },
    },
  };
}

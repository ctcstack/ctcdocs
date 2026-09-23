/**
 * Serves a project's built site in the foreground, for the browser suite.
 *
 * From Astro 7.2, `astro preview` on macOS and Linux restarts itself as a
 * detached background process and exits when it detects an AI agent among its
 * ancestors, and its CLI offers no switch to keep it in the foreground. A test
 * runner that owns the server's lifetime then sees its command exit, and the
 * detached server outlives the run holding the port. Astro's programmatic
 * `preview()` starts the same server without that detection and without the
 * lock file the CLI keeps under `.astro/`, so this process is the server
 * whoever starts it, and stopping it stops the server.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { preview } from 'astro';

const USAGE = 'Usage: ctcdocs-preview [--host <address>] [--port <number>]';

class PreviewUsageError extends Error {}

/**
 * The server part of Astro's inline configuration, from the flags
 * `astro preview` takes for it. A flag left out keeps Astro's default.
 */
export function parsePreviewArguments(args) {
  let values;
  try {
    ({ values } = parseArgs({
      args,
      options: {
        host: { type: 'string' },
        port: { type: 'string' },
      },
    }));
  } catch (error) {
    throw new PreviewUsageError(`${error.message}\n${USAGE}`);
  }

  const server = {};
  if (values.host !== undefined) {
    if (values.host === '') {
      throw new PreviewUsageError(`--host needs an address.\n${USAGE}`);
    }
    server.host = values.host;
  }
  if (values.port !== undefined) {
    const port = Number(values.port);
    if (
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65_535 ||
      String(port) !== values.port
    ) {
      throw new PreviewUsageError(
        `--port takes a port number from 1 to 65535, not "${values.port}".\n${USAGE}`,
      );
    }
    server.port = port;
  }
  return { server };
}

/**
 * Whether this module is the program being run.
 *
 * The comparison goes through `realpath` because a package manager installs a
 * bin as a symlink: `process.argv[1]` is then the link in `node_modules/.bin`
 * while `import.meta.url` is the file it points at.
 */
function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  try {
    const server = await preview(parsePreviewArguments(process.argv.slice(2)));
    await server.closed();
  } catch (error) {
    console.error(
      `ERROR [PREVIEW]: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = error instanceof PreviewUsageError ? 2 : 1;
  }
}

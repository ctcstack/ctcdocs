import { fileURLToPath } from 'node:url';

/*
 * The Astro plugin is resolved to a path rather than named.
 *
 * Prettier resolves a plugin name from the directory it was invoked in, not
 * from the configuration that names it, so a project consuming this file would
 * otherwise have to install the plugin itself. Resolving it here means the
 * dependency belongs to the package that needs it.
 */
const astroPlugin = fileURLToPath(import.meta.resolve('prettier-plugin-astro'));

/**
 * The formatting every CTCDocs project shares.
 *
 * A project's `prettier.config.mjs` is one line:
 *
 *     export { default } from '@ctcstack/ctcdocs/prettier';
 *
 * @type {import('prettier').Config}
 */
export default {
  plugins: [astroPlugin],
  singleQuote: true,
  trailingComma: 'all',
  overrides: [
    {
      files: '*.astro',
      options: {
        parser: 'astro',
      },
    },
  ],
};

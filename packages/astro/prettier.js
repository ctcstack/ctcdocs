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
  plugins: ['prettier-plugin-astro'],
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

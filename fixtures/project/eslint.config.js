import { ctcdocsEslintConfig } from '@ctcstack/ctcdocs/eslint';

/*
 * What a project's lint configuration is: the platform's rules, plus the paths
 * this project does not own. Generated output is excluded because the pipeline
 * writes it and a lint failure there is not a thing anyone can fix by editing.
 */
export default [
  {
    ignores: [
      '.astro/**',
      'dist/**',
      'src/content/docs/_generated/**',
      'src/assets/generated/**',
      'src/generated/**',
    ],
  },
  ...ctcdocsEslintConfig,
];

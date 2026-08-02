import { ctcdocsEslintConfig } from './packages/astro/eslint.js';

/*
 * The rules live in the package projects consume, so the platform lints itself
 * with exactly what it ships. Only the ignore list is repository-specific.
 */
export default [
  {
    ignores: [
      '**/.astro/**',
      '**/.playwright-browsers/**',
      '**/.wrangler/**',
      '**/coverage/**',
      '**/dist/**',
      '**/dist-node/**',
      '**/node_modules/**',
      // Pipeline-owned output in the fixture project.
      'fixtures/project/src/content/docs/_generated/**',
      'fixtures/project/src/assets/generated/**',
      'fixtures/project/src/generated/**',
    ],
  },
  ...ctcdocsEslintConfig,
];

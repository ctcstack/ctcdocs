import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import eslintPluginAstro from 'eslint-plugin-astro';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * The platform's own lint configuration, and the one projects consume through
 * `@ctcstack/ctcdocs/eslint`. Keeping one definition is the point of the split:
 * a rule added here reaches every deployment with the next version bump.
 */
export const ctcdocsEslintConfig = [
  js.configs.recommended,
  ...tseslint.configs.strict,
  ...eslintPluginAstro.configs.recommended,
  {
    files: ['**/*.{js,mjs,ts}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['**/*.astro'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  eslintConfigPrettier,
];

export default [
  {
    ignores: [
      '**/.astro/**',
      '**/.playwright-browsers/**',
      '**/.wrangler/**',
      '**/coverage/**',
      '**/dist/**',
      '**/node_modules/**',
      // Pipeline-owned output in the fixture project.
      'fixtures/project/src/content/docs/_generated/**',
      'fixtures/project/src/assets/generated/**',
      'fixtures/project/src/generated/**',
    ],
  },
  ...ctcdocsEslintConfig,
];

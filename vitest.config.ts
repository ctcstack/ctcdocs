import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // The MCP server's OAuth library imports Cloudflare's runtime module.
      'cloudflare:workers': fileURLToPath(
        new URL(
          './packages/astro/worker/agents/cloudflare-workers.stub.ts',
          import.meta.url,
        ),
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts'],
    server: {
      deps: { inline: ['@cloudflare/workers-oauth-provider'] },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['packages/*/src/cli.ts', 'packages/*/src/index.ts'],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
});

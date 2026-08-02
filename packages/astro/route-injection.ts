/**
 * The routes the platform owns, injected rather than copied.
 *
 * A project holds content and configuration; it should not have to carry three
 * route files that must stay identical across deployments. This integration is
 * private to the preset — projects never name it — and exists only so those
 * files can live in the package while still being part of the project's build.
 */
import { PLATFORM_ROUTES } from '@ctcstack/ctcdocs-core';
import type { AstroIntegration } from 'astro';

const ROUTES = [
  { entrypoint: '@ctcstack/ctcdocs/routes/index.astro', pattern: '/' },
  {
    entrypoint: '@ctcstack/ctcdocs/routes/documents/index.astro',
    pattern: `/${PLATFORM_ROUTES.fullIndex}`,
  },
  {
    entrypoint: '@ctcstack/ctcdocs/routes/[...slug]/index.md.ts',
    pattern: '/[...slug]/index.md',
  },
  {
    entrypoint:
      '@ctcstack/ctcdocs/routes/assets/generated/[documentId]/[asset].ts',
    pattern: '/assets/generated/[documentId]/[asset]',
  },
] as const;

export function ctcdocsRoutes(): AstroIntegration {
  return {
    name: '@ctcstack/ctcdocs/routes',
    hooks: {
      'astro:config:setup': ({ injectRoute }) => {
        for (const route of ROUTES) {
          injectRoute({
            entrypoint: route.entrypoint,
            pattern: route.pattern,
            prerender: true,
          });
        }
      },
    },
  };
}

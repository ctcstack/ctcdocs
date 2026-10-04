/**
 * The routes the platform owns, injected rather than copied.
 *
 * A project holds content and configuration; it should not have to carry three
 * route files that must stay identical across deployments. This integration is
 * private to the preset — projects never name it — and exists only so those
 * files can live in the package while still being part of the project's build.
 *
 * It also serves the generated sidebar to those routes as a virtual module.
 * The `llms.txt` indexes list the corpus in the order readers see it, and the
 * sidebar is the only place that order exists: it is derived by the sync from
 * Drive names (ADR-013) and reaches the build only through the preset.
 */
import { PLATFORM_ROUTES } from '@ctcstack/ctcdocs-core';
import type { AstroIntegration } from 'astro';

const ROUTES = [
  { entrypoint: '@ctcstack/ctcdocs/routes/index.astro', pattern: '/' },
  // Replaces Starlight's own, which is switched off in the preset.
  { entrypoint: '@ctcstack/ctcdocs/routes/404.astro', pattern: '/404' },
  {
    entrypoint: '@ctcstack/ctcdocs/routes/documents/index.astro',
    pattern: `/${PLATFORM_ROUTES.fullIndex}`,
  },
  {
    entrypoint: '@ctcstack/ctcdocs/routes/content-health.astro',
    pattern: `/${PLATFORM_ROUTES.contentHealth}`,
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
  { entrypoint: '@ctcstack/ctcdocs/routes/llms.txt.ts', pattern: '/llms.txt' },
  {
    entrypoint: '@ctcstack/ctcdocs/routes/[...section]/llms.txt.ts',
    pattern: '/[...section]/llms.txt',
  },
] as const;

/** Declared for the routes in `lib/virtual-modules.d.ts`. */
const NAVIGATION_MODULE = 'virtual:ctcdocs/navigation';
const RESOLVED_NAVIGATION_MODULE = `\0${NAVIGATION_MODULE}`;

/**
 * Who may read each folder (ADR-045). Without access rules there is nothing to
 * review, and the address is not served.
 */
const ACCESS_REVIEW = {
  entrypoint: '@ctcstack/ctcdocs/routes/access-review.astro',
  pattern: `/${PLATFORM_ROUTES.accessReview}`,
} as const;

export interface CtcdocsRoutesOptions {
  /** The generated sidebar, without the project's prefix. */
  navigation: readonly unknown[];
  /** Whether the project has access rules, so an access review to build. */
  accessRules: boolean;
}

export function ctcdocsRoutes({
  navigation,
  accessRules,
}: CtcdocsRoutesOptions): AstroIntegration {
  return {
    name: '@ctcstack/ctcdocs/routes',
    hooks: {
      'astro:config:setup': ({ injectRoute, updateConfig }) => {
        updateConfig({
          vite: {
            plugins: [
              {
                name: '@ctcstack/ctcdocs/navigation',
                resolveId: (id: string) =>
                  id === NAVIGATION_MODULE
                    ? RESOLVED_NAVIGATION_MODULE
                    : undefined,
                load: (id: string) =>
                  id === RESOLVED_NAVIGATION_MODULE
                    ? `export default ${JSON.stringify(navigation)};`
                    : undefined,
              },
            ],
          },
        });
        for (const route of accessRules ? [...ROUTES, ACCESS_REVIEW] : ROUTES) {
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

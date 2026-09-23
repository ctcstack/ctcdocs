/**
 * Starlight's cascade layer order, as `@astrojs/starlight/style/layers.css`
 * declares it.
 *
 * A layer's rank is fixed where its name first appears, and Starlight relies
 * on `Page.astro` importing that statement before any layered rule. The
 * bundler does not keep that promise: Rollup moves modules shared between
 * routes — the custom CSS and most component styles — into a chunk that
 * `Page.astro`'s own chunk imports, and Vite links a dependency's stylesheet
 * first. Which modules end up shared depends on each project's module graph,
 * so a site can ship `starlight.content`, `.core` and `.components` rules
 * ahead of the statement, and the reset then outranks every component.
 *
 * The Head override writes this statement inline. Astro renders the page's
 * stylesheet links at the end of `<head>`, after it, so the order holds on
 * every page whatever the chunking. The file is not in Starlight's package
 * exports, so the text is repeated here and a unit test keeps it equal to the
 * installed version.
 */
export const STARLIGHT_LAYER_ORDER =
  '@layer starlight.base, starlight.reset, starlight.core, starlight.content, starlight.components, starlight.utils;';

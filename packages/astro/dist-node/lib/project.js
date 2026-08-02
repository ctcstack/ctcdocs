/**
 * The project this build is producing a site for.
 *
 * Components run at build time, in Node, with the project root as the working
 * directory: `astro build` resolves its root there, and so does every script a
 * project's `package.json` runs. Reading the configuration once here — rather
 * than passing it through every component's props — keeps the components
 * looking the way they did when the configuration was a bundled import, while
 * the value itself comes from the project rather than from this package.
 *
 * Nothing here is reachable from the browser bundle: only build-time modules
 * import it.
 */
import { findProjectRoot, generatedMarkdownHeader, loadSiteConfiguration, } from '@ctcstack/ctcdocs-core';
export const siteConfiguration = loadSiteConfiguration(findProjectRoot());
/** Ownership marker of generated Markdown, stripped from the published form. */
export const markdownOwnershipHeader = generatedMarkdownHeader(siteConfiguration);

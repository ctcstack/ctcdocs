import { type PlaywrightTestConfig } from '@playwright/test';
export interface UxConfigOptions {
    /** Port the preview server binds while the suite runs. */
    port?: number;
    /** Command that serves the built site. Defaults to the project's `preview`. */
    previewCommand?: string;
}
/**
 * The local gate: builds are served from the project's own preview server, and
 * the suite asserts accessibility and interface behavior against the corpus
 * that project has.
 */
export declare function defineUxConfig(options?: UxConfigOptions): PlaywrightTestConfig;
/**
 * The deployed gate: proves Cloudflare Access denies anonymous traffic and
 * admits a service token. It runs against a real hostname, so it takes the
 * project's production origin unless told otherwise.
 */
export declare function defineAccessConfig(): PlaywrightTestConfig;

/**
 * Where the browser notes that the reader has opened the site switcher once
 * (components/SiteSwitcher.astro), after which it no longer marks itself as
 * new.
 */
export const SWITCHER_SEEN_KEY = 'ctcdocs:switcher-seen';

/**
 * Where the browser keeps, for a visit, the address the reader signed in with
 * and when it was read, so the account button shows their initials on every
 * page without waiting for the Worker (components/HeaderActions.astro).
 * Signing out clears it.
 */
export const READER_CACHE_KEY = 'ctcdocs:reader';

/** How long a kept address is shown before the Worker is asked again. */
export const READER_CACHE_MS = 10 * 60 * 1000;

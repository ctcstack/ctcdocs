/**
 * Where the browser keeps the reader's choice to hide the sidebar. The value
 * is "hidden" or absent; Head.astro reads it before paint and SiteTitle.astro
 * writes it.
 */
export const SIDEBAR_STATE_KEY = 'ctcdocs:sidebar';

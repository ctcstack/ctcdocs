/**
 * The response headers of a private deployment, set by the Worker (ADR-038).
 *
 * Cloudflare does not apply `_headers` to responses a Worker returns, so the
 * policy the project's `_headers` file held lives here: pages are revalidated
 * on every view, other content is cached privately and briefly, and nothing
 * asks to be indexed; fingerprinted scripts,
 * styles and fonts are cached for a year; anything that depends on who is
 * asking is not cached at all. Every HTML page carries a Content Security
 * Policy that admits the site's own scripts and the inline ones the build
 * hashed, and frames from Google Drive's player, and nothing else.
 */
import type { AccessMapFile } from './access-map.js';

export type CachePolicy = 'content' | 'immutable' | 'no-store';

const IMMUTABLE = /^\/_astro\/.+\.(?:css|js|mjs|woff2?)$/u;

export function cachePolicyFor(path: string): CachePolicy {
  return IMMUTABLE.test(path) ? 'immutable' : 'content';
}

function contentSecurityPolicy(map: AccessMapFile): string {
  const scripts = map.csp.scriptHashes.map((hash) => `'${hash}'`).join(' ');
  return [
    "default-src 'self'",
    // Pagefind compiles WebAssembly; nothing else is evaluated.
    `script-src 'self' 'wasm-unsafe-eval'${scripts ? ` ${scripts}` : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    // The build inlines small font files into its stylesheets.
    "font-src 'self' data:",
    "connect-src 'self'",
    // A PDF's page shows the file in an <object> (ADR-027).
    "object-src 'self'",
    /*
     * A recording's page plays it in Drive's own player (ADR-047). Drive
     * decides who may play it; nothing else is framed.
     */
    'frame-src https://drive.google.com',
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; ');
}

const CONTENT_TYPES: ReadonlyArray<[RegExp, string]> = [
  [/\.md$/u, 'text/markdown; charset=utf-8'],
  [/\.txt$/u, 'text/plain; charset=utf-8'],
];

/** Browsers reach every environment over HTTPS only, for a year. */
const TRANSPORT_SECURITY = 'max-age=31536000';

/** A copy of `response` that tells the browser to keep to HTTPS. */
export function withTransportSecurity(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Strict-Transport-Security', TRANSPORT_SECURITY);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * A public environment's response: nothing is private, but the headers
 * `_headers` would have set behind no Worker still apply — the charset of
 * Markdown and text, `nosniff`, and a year for fingerprinted assets.
 */
export function withPublicPolicy(response: Response, path: string): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'same-origin');
  if (cachePolicyFor(path) === 'immutable') {
    headers.set('Cache-Control', 'public, max-age=31556952, immutable');
  }
  for (const [pattern, type] of CONTENT_TYPES) {
    if (pattern.test(path) && response.ok) {
      headers.set('Content-Type', type);
    }
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** A copy of `response` with the policy's headers. */
export function withPolicy(
  response: Response,
  {
    path,
    policy,
    map,
    ownPolicy = false,
  }: {
    path: string;
    policy: CachePolicy;
    map: AccessMapFile;
    /** The Worker wrote this page's Content Security Policy itself. */
    ownPolicy?: boolean;
  },
): Response {
  const headers = new Headers(response.headers);
  const html = (headers.get('Content-Type') ?? '').startsWith('text/html');
  headers.set(
    'Cache-Control',
    policy === 'immutable'
      ? 'public, max-age=31556952, immutable'
      : policy === 'no-store'
        ? 'no-store'
        : // A page is checked with the Worker each time it is shown, so one
          // read before signing out is not shown from the cache after it.
          html
          ? 'private, no-cache'
          : 'private, max-age=60, must-revalidate',
  );
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  headers.set('Referrer-Policy', 'same-origin');
  for (const [pattern, type] of CONTENT_TYPES) {
    if (pattern.test(path)) {
      headers.set('Content-Type', type);
    }
  }
  if (html && !(ownPolicy && headers.has('Content-Security-Policy'))) {
    headers.set('Content-Security-Policy', contentSecurityPolicy(map));
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

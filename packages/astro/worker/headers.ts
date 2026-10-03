/**
 * The response headers of a private deployment, set by the Worker (ADR-038).
 *
 * Cloudflare does not apply `_headers` to responses a Worker returns, so the
 * policy the project's `_headers` file held lives here: content is cached
 * privately and briefly and asks not to be indexed; fingerprinted scripts,
 * styles and fonts are cached for a year; anything that depends on who is
 * asking is not cached at all. Every HTML page carries a Content Security
 * Policy that admits the site's own scripts and the inline ones the build
 * hashed, and nothing else.
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
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
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
  }: { path: string; policy: CachePolicy; map: AccessMapFile },
): Response {
  const headers = new Headers(response.headers);
  headers.set(
    'Cache-Control',
    policy === 'immutable'
      ? 'public, max-age=31556952, immutable'
      : policy === 'no-store'
        ? 'no-store'
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
  if ((headers.get('Content-Type') ?? '').startsWith('text/html')) {
    headers.set('Content-Security-Policy', contentSecurityPolicy(map));
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

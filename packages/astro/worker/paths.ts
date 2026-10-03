/**
 * Turning a request into the one file it names, before it is judged
 * (ADR-038).
 *
 * The access map lists files by their decoded, canonical path. Anything that
 * could make two spellings name one file differently — an encoded separator,
 * a dot segment, an empty segment, a NUL — is refused outright rather than
 * normalized, because a normalization the asset server does not share is a way
 * around the map.
 */

const ENCODED_SEPARATOR = /%(?:2f|5c|2e|00)/iu;

/** The canonical path a URL names, or `undefined` when it is refused. */
export function canonicalPath(url: URL): string | undefined {
  const raw = url.pathname;
  if (!raw.startsWith('/') || ENCODED_SEPARATOR.test(raw)) {
    return undefined;
  }
  let path: string;
  try {
    path = decodeURIComponent(raw);
  } catch {
    return undefined;
  }
  if (path.includes('\0') || path.includes('\\') || path.includes('//')) {
    return undefined;
  }
  if (path.split('/').some((segment) => segment === '.' || segment === '..')) {
    return undefined;
  }
  if (path.endsWith('/index.html')) {
    return path.slice(0, -'index.html'.length);
  }
  return path;
}

/** A canonical path as a URL's path again, each segment encoded. */
export function sitePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/** Longer return paths would push the sign-in cookie past what browsers keep. */
const LONGEST_RETURN_PATH = 1024;

/**
 * Where a reader is sent back after signing in: a path on this site only.
 * Anything else — another origin, a protocol-relative address, a path the
 * canonical form refuses — returns them to the home page.
 */
export function returnPath(value: string | null | undefined): string {
  if (
    !value ||
    value.length > LONGEST_RETURN_PATH ||
    !value.startsWith('/') ||
    value.startsWith('//')
  ) {
    return '/';
  }
  let url: URL;
  try {
    url = new URL(value, 'https://site.invalid');
  } catch {
    return '/';
  }
  if (url.origin !== 'https://site.invalid' || !canonicalPath(url)) {
    return '/';
  }
  return `${url.pathname}${url.search}`;
}

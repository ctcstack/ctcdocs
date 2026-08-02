import { posix } from 'node:path';

const ABSOLUTE_SCHEME = /^[a-z][a-z0-9+.-]*:/iu;
const SAFE_LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:']);
const POLICY_BASE_URL = 'https://archive.invalid/';

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

export function isAllowedLinkUrl(value: string): boolean {
  if (
    value.length === 0 ||
    value !== value.trim() ||
    value.startsWith('//') ||
    value.includes('\\') ||
    containsControlCharacter(value)
  ) {
    return false;
  }

  try {
    const parsed = new URL(value, POLICY_BASE_URL);
    return (
      !ABSOLUTE_SCHEME.test(value) || SAFE_LINK_SCHEMES.has(parsed.protocol)
    );
  } catch {
    return false;
  }
}

/*
 * Google's own redirector, and only it. Its HTML export routes every link
 * through `https://www.google.com/url?q=<target>` with an export timestamp and
 * a signature attached — values Google regenerates on every export, so a
 * document that has not changed still produces a diff, and a link between two
 * documents in the same corpus is not recognizable as one.
 *
 * The list is exactly two hosts rather than a pattern over Google's domains:
 * unwrapping is a rewrite of where a reader ends up, and a loose match would
 * apply it to some other site's redirect.
 */
const GOOGLE_REDIRECT_HOSTS = new Set(['www.google.com', 'google.com']);
const UNWRAPPABLE_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

/**
 * The address a Google redirect leads to, or `undefined` when the value is not
 * one of its wrappers.
 *
 * A target that is not itself a safe absolute link is left wrapped: the wrapper
 * is a plain HTTPS URL that the rest of the policy has already accepted, and
 * replacing it with something the policy would reject is the one outcome worse
 * than keeping the redirect.
 */
export function unwrapGoogleRedirect(value: string): string | undefined {
  let wrapper: URL;
  try {
    wrapper = new URL(value);
  } catch {
    return undefined;
  }
  if (
    !GOOGLE_REDIRECT_HOSTS.has(wrapper.hostname) ||
    wrapper.pathname !== '/url'
  ) {
    return undefined;
  }

  const target =
    wrapper.searchParams.get('q') ?? wrapper.searchParams.get('url');
  if (!target || !isAllowedLinkUrl(target)) {
    return undefined;
  }
  try {
    return UNWRAPPABLE_SCHEMES.has(new URL(target).protocol)
      ? target
      : undefined;
  } catch {
    return undefined;
  }
}

export function resolveArchiveAssetPath(
  htmlPath: string,
  value: string,
): string | undefined {
  if (
    value.length === 0 ||
    value !== value.trim() ||
    value.startsWith('/') ||
    value.startsWith('//') ||
    value.startsWith('#') ||
    value.includes('\\') ||
    value.includes('?') ||
    value.includes('#') ||
    ABSOLUTE_SCHEME.test(value) ||
    containsControlCharacter(value)
  ) {
    return undefined;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return undefined;
  }
  if (
    decoded.split('/').some((segment) => segment === '..') ||
    decoded.includes('\0')
  ) {
    return undefined;
  }

  const resolved = posix
    .normalize(posix.join(posix.dirname(htmlPath), decoded))
    .normalize('NFC');
  return resolved === '.' ||
    resolved === '..' ||
    resolved.startsWith('../') ||
    resolved.startsWith('/')
    ? undefined
    : resolved;
}

export function isAllowedSvgReference(value: string): boolean {
  return (
    value.startsWith('#') &&
    value.length > 1 &&
    !containsControlCharacter(value)
  );
}

import { collectMarkdownLinkUrls } from '../markdown/analyze-markdown.js';

const ABSOLUTE_SCHEME = /^[a-z][a-z0-9+.-]*:/iu;
const VALIDATION_ORIGIN = 'https://generated-wiki.invalid';

export interface LinkValidationDocument {
  body: string;
  stableSlug: string;
}

export interface BrokenInternalLink {
  sourceSlug: string;
  targetPath: string;
}

function routePath(value: string, sourceSlug: string): string | undefined {
  if (
    !value ||
    value.startsWith('#') ||
    value.startsWith('//') ||
    ABSOLUTE_SCHEME.test(value)
  ) {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(value, `${VALIDATION_ORIGIN}/${sourceSlug}/`);
  } catch {
    return undefined;
  }
  if (parsed.origin !== VALIDATION_ORIGIN) {
    return undefined;
  }
  try {
    return decodeURIComponent(parsed.pathname)
      .replace(/^\/+/u, '')
      .replace(/\/+$/u, '');
  } catch {
    return parsed.pathname.replace(/^\/+|\/+$/gu, '');
  }
}

export function findBrokenInternalLinks(
  documents: readonly LinkValidationDocument[],
  redirectSlugs: ReadonlySet<string> = new Set(),
  staticSlugs: ReadonlySet<string> = new Set(['', 'about-wiki']),
): BrokenInternalLink[] {
  const validSlugs = new Set([
    ...documents.map((document) => document.stableSlug),
    ...redirectSlugs,
    ...staticSlugs,
  ]);
  const broken: BrokenInternalLink[] = [];
  for (const document of [...documents].sort((left, right) =>
    left.stableSlug < right.stableSlug
      ? -1
      : left.stableSlug > right.stableSlug
        ? 1
        : 0,
  )) {
    for (const url of collectMarkdownLinkUrls(document.body)) {
      const targetPath = routePath(url, document.stableSlug);
      if (targetPath !== undefined && !validSlugs.has(targetPath)) {
        broken.push({ sourceSlug: document.stableSlug, targetPath });
      }
    }
  }
  return broken.sort((left, right) =>
    left.sourceSlug === right.sourceSlug
      ? left.targetPath < right.targetPath
        ? -1
        : left.targetPath > right.targetPath
          ? 1
          : 0
      : left.sourceSlug < right.sourceSlug
        ? -1
        : 1,
  );
}

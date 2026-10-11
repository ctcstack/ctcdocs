/**
 * The latest insights report as the Worker gives it to an admin (ADR-051),
 * for the content health page's section "What people could not find".
 *
 * Browser code: it must not import the platform's core, whose entry reads
 * the file system. The route is restated here and a test keeps it equal to
 * the Worker's. Any failure — no Worker, a refusal, an answer of the wrong
 * shape — gives nothing, and the section stays hidden. A group or document
 * of the wrong shape is left out; a link is kept only when it is a
 * document's permanent link on this site.
 */

/** Where the Worker answers an admin with the latest report. */
export const INSIGHTS_ROUTE = '/_kb/insights.json';

const PERMANENT_LINK = /^\/d\/[0-9a-f]{6,64}\/$/u;

export interface NamedDocument {
  readonly id: string;
  /** Its title and link, when the build lists it. */
  readonly title?: string;
  readonly url?: string;
}

export interface MissedGroup {
  readonly label: string;
  readonly count: number;
  readonly site: number;
  /** Other ways it was asked, most asked first. */
  readonly variants: readonly string[];
  readonly clients: readonly string[];
  /** What its searches nearly found. */
  readonly documents: readonly NamedDocument[];
}

interface InsightsView {
  readonly week: string;
  readonly searches: number;
  readonly notFound: number;
  readonly siteSearches: number;
  readonly siteNotFound: number;
  readonly groups: readonly MissedGroup[];
  readonly unread: readonly (NamedDocument & {
    readonly appearances: number;
    readonly fetches: number;
  })[];
}

/** The answer: a report to show, none kept yet, or nothing to show. */
export type InsightsAnswer =
  | { readonly kind: 'report'; readonly view: InsightsView }
  | { readonly kind: 'none' };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;
const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function named(
  id: unknown,
  documents: Record<string, unknown>,
): NamedDocument | undefined {
  if (typeof id !== 'string' || !/^[0-9a-f]{6,64}$/u.test(id)) {
    return undefined;
  }
  const entry = documents[id];
  return isRecord(entry) &&
    isText(entry.title) &&
    typeof entry.url === 'string' &&
    PERMANENT_LINK.test(entry.url)
    ? { id, title: entry.title, url: entry.url }
    : { id };
}

function group(
  value: unknown,
  documents: Record<string, unknown>,
): MissedGroup | undefined {
  if (!isRecord(value) || !isText(value.label) || !isCount(value.count)) {
    return undefined;
  }
  const label = value.label;
  return {
    label,
    count: value.count,
    site: isCount(value.site) ? value.site : 0,
    variants: list(value.queries).flatMap((entry) =>
      isRecord(entry) && isText(entry.query) && entry.query !== label
        ? [entry.query]
        : [],
    ),
    clients: list(value.clients).flatMap((entry) =>
      isRecord(entry) && isText(entry.client) ? [entry.client] : [],
    ),
    documents: list(value.documents).flatMap((entry) => {
      const document = isRecord(entry) ? named(entry.id, documents) : undefined;
      return document ? [document] : [];
    }),
  };
}

function share(value: unknown): { searches: number; notFound: number } {
  return isRecord(value) && isCount(value.searches) && isCount(value.notFound)
    ? { searches: value.searches, notFound: value.notFound }
    : { searches: 0, notFound: 0 };
}

export function parseInsights(body: unknown): InsightsAnswer | undefined {
  if (!isRecord(body)) {
    return undefined;
  }
  if (body.report === null) {
    return { kind: 'none' };
  }
  const { report } = body;
  const documents = isRecord(body.documents) ? body.documents : {};
  if (
    !isRecord(report) ||
    typeof report.week !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(report.week)
  ) {
    return undefined;
  }
  const use = isRecord(report.use) ? report.use : {};
  const notFound = isRecord(use.notFound) ? use.notFound : {};
  const mcp = share(notFound.mcp);
  const site = share(notFound.site);
  return {
    kind: 'report',
    view: {
      week: report.week,
      searches: mcp.searches,
      notFound: mcp.notFound,
      siteSearches: site.searches,
      siteNotFound: site.notFound,
      groups: list(report.notFound).flatMap((entry) => {
        const parsed = group(entry, documents);
        return parsed ? [parsed] : [];
      }),
      unread: list(report.foundNotRead).flatMap((entry) => {
        if (
          !isRecord(entry) ||
          !isCount(entry.appearances) ||
          !isCount(entry.fetches)
        ) {
          return [];
        }
        const document = named(entry.id, documents);
        return document
          ? [
              {
                ...document,
                appearances: entry.appearances,
                fetches: entry.fetches,
              },
            ]
          : [];
      }),
    },
  };
}

export async function readInsights(
  fetchImplementation: typeof fetch = fetch,
): Promise<InsightsAnswer | undefined> {
  try {
    const response = await fetchImplementation(INSIGHTS_ROUTE, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      return undefined;
    }
    return parseInsights(await response.json());
  } catch {
    return undefined;
  }
}

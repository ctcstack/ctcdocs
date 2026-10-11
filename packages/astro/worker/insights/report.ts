/**
 * The weekly report (ADR-051): what people and assistants could not find,
 * what they ask most, what they find and do not read, and how they use the
 * MCP server. A pure function of a week's records, so the Worker's schedule
 * and `ctcdocs-insights` make the same report from the same rows.
 *
 * A report names documents by short ID, classes by the access map's names
 * and clients by their labels; the only text in it is the queries. It is
 * bounded: the groups it lists, and the queries each holds, are capped.
 *
 * What counts as not found: an MCP search with no result, or whose best
 * result scores under the weak line, and a site search with no result. A
 * search kept to a folder, a date or a format, or one with no word in it, is
 * counted in the use but never as a gap: what it missed may be there.
 */
import { queryWords } from './words.js';

type McpTool = 'search' | 'fetch' | 'browse' | 'recent';

/** A record of an MCP call, as the report reads it. */
export interface CallRow {
  readonly id: number;
  readonly tool: McpTool;
  readonly query: string | null;
  readonly narrowed: boolean;
  readonly classes: readonly string[];
  readonly client: string | null;
  readonly results: number;
  readonly topScore: number | null;
  readonly documents: readonly string[];
  readonly fetched: string | null;
  readonly characters: number;
  readonly latencyMs: number;
}

/** A record of a settled site search, as the report reads it. */
export interface SiteSearchRow {
  readonly id: number;
  readonly query: string;
  readonly classes: readonly string[];
  readonly results: number;
}

export interface ReportSettings {
  /** `insights.weakScore`; unset, the week's lowest fifth is weak. */
  readonly weakScore?: number | undefined;
  readonly stopWords: ReadonlySet<string>;
}

export interface ReportWeek {
  /** The Monday the week begins, `YYYY-MM-DD`. */
  readonly week: string;
  readonly from: string;
  readonly to: string;
}

interface QueryGroup {
  /** The query asked most in the group, as asked. */
  readonly label: string;
  readonly words: readonly string[];
  readonly count: number;
  readonly mcp: number;
  readonly site: number;
  readonly queries: readonly {
    readonly query: string;
    readonly count: number;
  }[];
  /** How many of its searches could read each class. */
  readonly classes: Readonly<Record<string, number>>;
  readonly clients: readonly {
    readonly client: string | null;
    readonly count: number;
  }[];
  /** Documents its searches returned, by how often: what they nearly found. */
  readonly documents: readonly {
    readonly id: string;
    readonly count: number;
  }[];
}

interface Share {
  readonly searches: number;
  readonly notFound: number;
  /** `notFound / searches`, to three places; null with no search. */
  readonly share: number | null;
}

export interface WeeklyReport extends ReportWeek {
  readonly version: 1;
  readonly made: string;
  readonly records: {
    readonly mcpCalls: number;
    readonly siteSearches: number;
    /** Whether the week held more records than the report read. */
    readonly truncated: boolean;
    /** Records the report could not read, and left out. */
    readonly unreadable: number;
  };
  /** The configured weak line, or the score the week's lowest fifth ends at. */
  readonly weakLine: {
    readonly configured: number | null;
    readonly relative: number | null;
  };
  readonly notFound: readonly QueryGroup[];
  readonly askedMost: readonly QueryGroup[];
  readonly foundNotRead: readonly {
    readonly id: string;
    readonly appearances: number;
    readonly fetches: number;
  }[];
  readonly use: {
    readonly calls: Readonly<Record<McpTool, number>>;
    readonly clients: readonly {
      readonly client: string | null;
      readonly calls: number;
    }[];
    readonly searchLatencyMs: {
      readonly median: number | null;
      readonly p95: number | null;
    };
    /** Median characters of an answer, by tool, among answers with text. */
    readonly characters: Readonly<Record<McpTool, number | null>>;
    readonly notFound: { readonly mcp: Share; readonly site: Share };
    /** Searches kept to a folder, a date or a format, never counted as gaps. */
    readonly narrowed: number;
    /** Searches with no word to group by. */
    readonly blank: number;
  };
}

const TOOLS: readonly McpTool[] = ['search', 'fetch', 'browse', 'recent'];
const NOT_FOUND_GROUPS = 50;
const ASKED_MOST_GROUPS = 20;
const QUERIES_PER_GROUP = 10;
const DOCUMENTS_PER_GROUP = 5;
const CLIENTS_PER_GROUP = 10;
const FOUND_NOT_READ = 20;
/** A document must be returned this often before its reading is judged. */
const MIN_APPEARANCES = 5;
/** Groups of distinct words compared for merging at most, largest first. */
const MERGED_GROUPS = 1_000;
/** Two word sets merge at this Jaccard similarity or above. */
const MERGE_SIMILARITY = 0.5;

/** One search, from either source, as the report groups it. */
interface Asked {
  readonly source: 'mcp' | 'site';
  readonly id: number;
  readonly query: string;
  readonly words: readonly string[];
  readonly narrowed: boolean;
  readonly classes: readonly string[];
  readonly client: string | null;
  readonly results: number;
  readonly topScore: number | null;
  readonly documents: readonly string[];
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Entries of a count, most first, then by key. */
function ranked<K extends string | null>(
  counts: ReadonlyMap<K, number>,
): [K, number][] {
  return [...counts].sort(
    ([a, x], [b, y]) => y - x || byText(String(a ?? ''), String(b ?? '')),
  );
}

function tally<K>(counts: Map<K, number>, key: K, by = 1): void {
  counts.set(key, (counts.get(key) ?? 0) + by);
}

/** The value at a fraction of the sorted values, by nearest rank. */
function percentile(
  values: readonly number[],
  fraction: number,
): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(fraction * sorted.length));
  return sorted[rank - 1] ?? null;
}

function share(searches: number, notFound: number): Share {
  return {
    searches,
    notFound,
    share:
      searches === 0 ? null : Math.round((notFound / searches) * 1000) / 1000,
  };
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let common = 0;
  for (const word of a) {
    if (b.has(word)) {
      common += 1;
    }
  }
  const union = a.size + b.size - common;
  return union === 0 ? 0 : common / union;
}

/** The document a set of searches returned first most often, if any. */
function bestDocument(searches: readonly Asked[]): string | undefined {
  const firsts = new Map<string, number>();
  for (const search of searches) {
    const first = search.documents[0];
    if (first !== undefined) {
      tally(firsts, first);
    }
  }
  return ranked(firsts)[0]?.[0];
}

/**
 * Groups searches by their words. Searches with the same words start one
 * group; two groups merge when their words overlap by half or more, as
 * Jaccard similarity, and, `byDocument`, when their best document is the
 * same. That holds for what was not found, where it means one gap asked in
 * other words; among all searches it would join every question a popular
 * document answers. The largest groups are compared; past them, a group
 * stands alone.
 */
function groupSearches(
  searches: readonly Asked[],
  byDocument: boolean,
): QueryGroup[] {
  const seeds = new Map<string, Asked[]>();
  for (const search of searches) {
    const key = search.words.join(' ');
    const members = seeds.get(key);
    if (members) {
      members.push(search);
    } else {
      seeds.set(key, [search]);
    }
  }
  const ordered = [...seeds].sort(
    ([a, x], [b, y]) => y.length - x.length || byText(a, b),
  );
  const parent = ordered.map((_, index) => index);
  const root = (index: number): number => {
    let at = index;
    while (parent[at] !== at) {
      at = parent[at] ?? at;
    }
    return at;
  };
  const compared = Math.min(ordered.length, MERGED_GROUPS);
  const words = ordered.map(([key]) => new Set(key.split(' ')));
  const best = ordered.map(([, members]) => bestDocument(members));
  for (let i = 0; i < compared; i += 1) {
    for (let j = i + 1; j < compared; j += 1) {
      const a = words[i];
      const b = words[j];
      const sameBest =
        byDocument && best[i] !== undefined && best[i] === best[j];
      if (sameBest || (a && b && jaccard(a, b) >= MERGE_SIMILARITY)) {
        const [x, y] = [root(i), root(j)];
        // The larger, earlier group is the root, so the result is stable.
        parent[Math.max(x, y)] = Math.min(x, y);
      }
    }
  }
  const merged = new Map<number, Asked[]>();
  ordered.forEach(([, members], index) => {
    const at = root(index);
    const group = merged.get(at);
    if (group) {
      group.push(...members);
    } else {
      merged.set(at, [...members]);
    }
  });
  return [...merged.values()]
    .map(describeGroup)
    .sort((a, b) => b.count - a.count || byText(a.label, b.label));
}

function describeGroup(members: readonly Asked[]): QueryGroup {
  const queries = new Map<string, number>();
  const classes = new Map<string, number>();
  const clients = new Map<string | null, number>();
  const documents = new Map<string, number>();
  const words = new Map<string, readonly string[]>();
  for (const member of members) {
    const query = member.query.trim();
    tally(queries, query);
    words.set(query, member.words);
    for (const cls of member.classes) {
      tally(classes, cls);
    }
    tally(clients, member.client);
    for (const id of member.documents) {
      tally(documents, id);
    }
  }
  // The query asked most; of those, the shortest, then the first by text.
  const label =
    [...queries].sort(
      ([a, x], [b, y]) => y - x || a.length - b.length || byText(a, b),
    )[0]?.[0] ?? '';
  return {
    label,
    words: words.get(label) ?? [],
    count: members.length,
    mcp: members.filter((member) => member.source === 'mcp').length,
    site: members.filter((member) => member.source === 'site').length,
    queries: ranked(queries)
      .slice(0, QUERIES_PER_GROUP)
      .map(([query, count]) => ({ query, count })),
    classes: Object.fromEntries([...classes].sort(([a], [b]) => byText(a, b))),
    clients: ranked(clients)
      .slice(0, CLIENTS_PER_GROUP)
      .map(([client, count]) => ({ client, count })),
    documents: ranked(documents)
      .slice(0, DOCUMENTS_PER_GROUP)
      .map(([id, count]) => ({ id, count })),
  };
}

/**
 * The searches whose best result is weak: under the configured line, or,
 * without one, the lowest fifth of the week's scored searches.
 */
function weakSearches(
  scored: readonly Asked[],
  weakScore: number | undefined,
): { weak: ReadonlySet<Asked>; relative: number | null } {
  if (weakScore !== undefined) {
    return {
      weak: new Set(
        scored.filter((search) => (search.topScore ?? 1) < weakScore),
      ),
      relative: null,
    };
  }
  const sorted = [...scored].sort(
    (a, b) => (a.topScore ?? 0) - (b.topScore ?? 0) || a.id - b.id,
  );
  const line = sorted[Math.floor(sorted.length / 5) - 1]?.topScore;
  // A search scoring as the fifth's last does is as weak as it is.
  return line === undefined || line === null
    ? { weak: new Set(), relative: null }
    : {
        weak: new Set(
          sorted.filter((search) => (search.topScore ?? 0) <= line),
        ),
        relative: line,
      };
}

export function weeklyReport({
  week,
  made,
  calls,
  siteSearches,
  truncated,
  unreadable = 0,
  settings,
}: {
  readonly week: ReportWeek;
  readonly made: string;
  readonly calls: readonly CallRow[];
  readonly siteSearches: readonly SiteSearchRow[];
  readonly truncated: boolean;
  readonly unreadable?: number;
  readonly settings: ReportSettings;
}): WeeklyReport {
  const words = (query: string) => queryWords(query, settings.stopWords);
  const asked: Asked[] = [
    ...calls
      .filter((call) => call.tool === 'search')
      .map((call) => ({
        source: 'mcp' as const,
        id: call.id,
        query: call.query ?? '',
        words: words(call.query ?? ''),
        narrowed: call.narrowed,
        classes: call.classes,
        client: call.client,
        results: call.results,
        topScore: call.topScore,
        documents: call.documents,
      })),
    ...siteSearches.map((search) => ({
      source: 'site' as const,
      id: search.id,
      query: search.query,
      words: words(search.query),
      narrowed: false,
      classes: search.classes,
      client: null,
      results: search.results,
      topScore: null,
      documents: [],
    })),
  ];
  const worded = asked.filter((search) => search.words.length > 0);
  const eligible = worded.filter((search) => !search.narrowed);
  const scored = eligible.filter(
    (search) =>
      search.source === 'mcp' && search.results > 0 && search.topScore !== null,
  );
  const { weak, relative } = weakSearches(scored, settings.weakScore);
  const missed = eligible.filter(
    (search) => search.results === 0 || weak.has(search),
  );
  const mcpEligible = eligible.filter((search) => search.source === 'mcp');

  // Found, not read: returned often, fetched under a tenth as often.
  const appearances = new Map<string, number>();
  const fetches = new Map<string, number>();
  for (const call of calls) {
    if (call.tool === 'search') {
      for (const id of call.documents) {
        tally(appearances, id);
      }
    } else if (call.tool === 'fetch' && call.fetched !== null) {
      tally(fetches, call.fetched);
    }
  }
  const foundNotRead = ranked(appearances)
    .filter(
      ([id, count]) =>
        count >= MIN_APPEARANCES && (fetches.get(id) ?? 0) * 10 < count,
    )
    .slice(0, FOUND_NOT_READ)
    .map(([id, count]) => ({
      id,
      appearances: count,
      fetches: fetches.get(id) ?? 0,
    }));

  const byTool = (tool: McpTool) => calls.filter((call) => call.tool === tool);
  const clients = new Map<string | null, number>();
  for (const call of calls) {
    tally(clients, call.client);
  }
  const searchLatency = byTool('search').map((call) => call.latencyMs);

  return {
    version: 1,
    ...week,
    made,
    records: {
      mcpCalls: calls.length,
      siteSearches: siteSearches.length,
      truncated,
      unreadable,
    },
    weakLine: { configured: settings.weakScore ?? null, relative },
    notFound: groupSearches(missed, true).slice(0, NOT_FOUND_GROUPS),
    askedMost: groupSearches(worded, false).slice(0, ASKED_MOST_GROUPS),
    foundNotRead,
    use: {
      calls: Object.fromEntries(
        TOOLS.map((tool) => [tool, byTool(tool).length]),
      ) as Record<McpTool, number>,
      clients: ranked(clients).map(([client, count]) => ({
        client,
        calls: count,
      })),
      searchLatencyMs: {
        median: percentile(searchLatency, 0.5),
        p95: percentile(searchLatency, 0.95),
      },
      characters: Object.fromEntries(
        TOOLS.map((tool) => [
          tool,
          percentile(
            byTool(tool)
              .filter((call) => call.characters > 0)
              .map((call) => call.characters),
            0.5,
          ),
        ]),
      ) as Record<McpTool, number | null>,
      notFound: {
        mcp: share(
          mcpEligible.length,
          missed.filter((search) => search.source === 'mcp').length,
        ),
        site: share(
          eligible.length - mcpEligible.length,
          missed.filter((search) => search.source === 'site').length,
        ),
      },
      narrowed: worded.filter((search) => search.narrowed).length,
      blank: asked.length - worded.length,
    },
  };
}

/**
 * The access map the build writes (ADR-039), as the Worker reads it.
 *
 * The Worker is bundled with the map of the build it serves, so the two
 * always deploy and roll back together. It must not import the platform's
 * core, whose entry reads the file system; the few constants it shares with
 * the core are restated here, and a test keeps them equal.
 */

export const MEMBERS_CLASS = 'members';
export const ADMINS_CLASS = 'admins';
/** Served to any signed-in reader: scripts, styles, fonts, public files. */
export const PLATFORM_FILE = 'platform';
/** Where the Worker lists a reader's search bundles. */
export const CLASSES_ROUTE = '/_kb/classes';
/** Where an admin reads the snapshot's age and counts. */
export const STATUS_ROUTE = '/_kb/status';
/** A document's permanent link is this, its short ID and a slash (ADR-022). */
export const PERMANENT_LINK_PREFIX = '/d/';

type Readers = '*' | readonly string[];
export type FileClass = string | readonly string[];

export interface AccessMapEnvironment {
  readonly origin: string;
  readonly hostname: string;
  readonly visibility: 'private' | 'public';
}

/**
 * How the MCP server searches and how much it returns (ADR-042): the
 * project's `mcp.search`, with the core's defaults, as the build resolved it.
 */
export interface AgentSearchSettings {
  readonly chunks: number;
  readonly vectorThreshold: number;
  readonly keywordMatch: 'and' | 'or';
  readonly contextChunks: number;
  readonly reranking: {
    readonly enabled: boolean;
    readonly model: string;
    readonly threshold: number;
  };
  readonly results: number;
  readonly passagesPerResult: number;
  readonly passageCharacters: number;
}

/** A document the MCP server publishes to R2 (ADR-041). */
export interface AgentDocument {
  readonly id: string;
  readonly title: string;
  readonly markdown: string;
  readonly modified: string | null;
  /** The folders from the corpus root to the document (ADR-042). */
  readonly path: readonly string[];
  /**
   * The Google Doc, PDF or spreadsheet in Drive it is published from
   * (ADR-042).
   */
  readonly source: string | null;
  /**
   * Whether it is published from a Google Doc, a PDF (ADR-044) or a
   * spreadsheet (ADR-046).
   */
  readonly format: 'doc' | 'pdf' | 'sheet';
  /** A PDF's pages, when the sync counted them. */
  readonly pages?: number;
  /** Characters of the stored text, which `fetch` returns (ADR-044). */
  readonly characters: number;
  readonly hash: string;
}

export interface AccessMapFile {
  readonly schemaVersion: number;
  readonly site: {
    readonly environments: Readonly<Record<string, AccessMapEnvironment>>;
    readonly workspaceDomains: readonly string[];
    readonly title: string;
    readonly description?: string;
    /** Whether the Worker serves the MCP server and its OAuth routes. */
    readonly mcp?: boolean;
  };
  readonly csp: { readonly scriptHashes: readonly string[] };
  readonly enabled: boolean;
  readonly admins: readonly string[];
  readonly classes: Readonly<
    Record<string, { readonly id: string; readonly readers: Readers }>
  >;
  readonly bundles: Readonly<Record<string, string>>;
  readonly files: Readonly<Record<string, FileClass>>;
  /** Present when the MCP server is on. */
  readonly agents?: {
    readonly digest: string;
    readonly documents: readonly AgentDocument[];
    readonly search: AgentSearchSettings;
    /** Characters `fetch` returns at most. */
    readonly fetchCharacters: number;
    /** Characters of JSON a `browse` tree takes at most (ADR-044). */
    readonly browseCharacters: number;
    /** Documents `recent` lists unless asked, and at most (ADR-044). */
    readonly recent: {
      readonly defaultResults: number;
      readonly results: number;
    };
  };
}

/** The environment a request reached, by its host; none for any other host. */
export function environmentOf(
  map: AccessMapFile,
  hostname: string,
): AccessMapEnvironment | undefined {
  return Object.values(map.site.environments).find(
    (environment) => environment.hostname === hostname,
  );
}

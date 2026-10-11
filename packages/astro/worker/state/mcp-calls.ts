/**
 * One record per MCP tool call (ADR-051), written after the answer.
 *
 * A record names the access classes the reader may read, as the access
 * decision reached them, never the reader: no address, `sub`, group or
 * session. Its query is cut to 200 characters, and its client is the name
 * the assistant gave when it connected, reduced to a plain label. A write
 * runs in the background and never fails or slows the answer: one that
 * fails is dropped and logged.
 */
import { ADMINS_CLASS, type AccessMapFile } from '../access-map.js';
import { isAdmin, type Reader } from '../decide.js';
import { readableClasses } from '../agents/documents.js';
import type { StateDatabase } from './database.js';

type McpTool = 'search' | 'fetch' | 'browse' | 'recent';

export interface McpCall {
  readonly at: string;
  readonly tool: McpTool;
  /** `search`'s query, cut to 200 characters when written; null for the others. */
  readonly query: string | null;
  readonly classes: readonly string[];
  readonly client: string | null;
  readonly results: number;
  readonly topScore: number | null;
  /** The first five short IDs the answer returned. */
  readonly documents: readonly string[];
  /** The short ID `fetch` read; null for the others. */
  readonly fetched: string | null;
  readonly characters: number;
  readonly latencyMs: number;
  readonly stale: boolean;
}

/** Hands a write to the runtime to finish after the answer. */
export type McpCallRecorder = (call: McpCall) => void;

const QUERY_CHARACTERS = 200;
const CLIENT_CHARACTERS = 64;
const DOCUMENTS = 5;
/** At most this much of a failure's message is logged. */
const MESSAGE_CHARACTERS = 200;

/**
 * The classes a record names: those the access decision lets the reader
 * read. An admin reads every class, and is named by the admins class alone;
 * while the snapshot is stale an admin reads what every member reads, and is
 * named as one.
 */
export function recordedClasses(
  map: AccessMapFile,
  reader: Reader,
  stale: boolean,
): string[] {
  return !stale && isAdmin(map, reader)
    ? [ADMINS_CLASS]
    : readableClasses(map, reader, stale);
}

/** A query as it is kept: its first 200 characters, never half of one. */
export function recordedQuery(query: string): string {
  return Array.from(query).slice(0, QUERY_CHARACTERS).join('');
}

/**
 * The name an assistant gave when it connected, as a label: letters, digits,
 * spaces and `.-_` only, at most 64 characters; none when nothing is left.
 * The name is the client's own claim, so it labels a report and nothing
 * more.
 */
export function clientLabel(name: string | undefined): string | undefined {
  const label = Array.from((name ?? '').replace(/\s/gu, ' '))
    .filter((character) => /^[A-Za-z0-9 ._-]$/u.test(character))
    .join('')
    .replace(/ +/gu, ' ')
    .trim()
    .slice(0, CLIENT_CHARACTERS)
    .trim();
  return label.length > 0 ? label : undefined;
}

export async function insertMcpCall(
  database: StateDatabase,
  call: McpCall,
): Promise<void> {
  await database
    .prepare(
      `INSERT INTO mcp_calls
        (at, tool, query, classes, client, results, top_score, documents,
         fetched, characters, latency_ms, stale)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      call.at,
      call.tool,
      call.query === null ? null : recordedQuery(call.query),
      JSON.stringify([...call.classes].sort()),
      call.client,
      call.results,
      call.topScore !== null && Number.isFinite(call.topScore)
        ? call.topScore
        : null,
      JSON.stringify(call.documents.slice(0, DOCUMENTS)),
      call.fetched,
      call.characters,
      Math.max(0, Math.round(call.latencyMs)),
      call.stale ? 1 : 0,
    )
    .run();
}

/**
 * Records calls in `database`, each write handed to `schedule`, which the
 * Worker's entry backs with `waitUntil`. Neither a write that fails nor one
 * that throws reaches the caller.
 */
export function mcpCallRecorder({
  database,
  schedule,
  log,
}: {
  readonly database: StateDatabase;
  readonly schedule: (write: Promise<void>) => void;
  readonly log: (event: Readonly<Record<string, unknown>>) => void;
}): McpCallRecorder {
  const failed = (error: unknown) => {
    // D1 names the table or the constraint that failed, never a bound value.
    log({
      event: 'state-write-failed',
      table: 'mcp_calls',
      error:
        error instanceof Error
          ? error.message.slice(0, MESSAGE_CHARACTERS)
          : 'unknown',
    });
  };
  return (call) => {
    try {
      schedule(insertMcpCall(database, call).catch(failed));
    } catch (error: unknown) {
      failed(error);
    }
  };
}

/**
 * One record per MCP tool call (ADR-051), written after the answer.
 *
 * A record names the access classes the reader may read, as the access
 * decision reached them, never the reader: no address, `sub`, group or
 * session. Its query is cut to 200 characters, and its client is a plain
 * label of the name the assistant gave when it connected. A write runs in
 * the background and never fails or slows the answer: one that fails is
 * dropped and logged.
 */
import type { StateDatabase } from './database.js';
import { failureMessage, recordedQuery, type StateLog } from './record.js';

type McpTool = 'search' | 'fetch' | 'browse' | 'recent';

export interface McpCall {
  readonly at: string;
  readonly tool: McpTool;
  /** `search`'s query, cut to 200 characters when written; null for the others. */
  readonly query: string | null;
  /** Whether the call kept itself to a folder, a date or a format. */
  readonly narrowed: boolean;
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

/** Hands the record of a call to the runtime to write after the answer. */
export type McpCallRecorder = (call: McpCall) => void;

const DOCUMENTS = 5;

export async function insertMcpCall(
  database: StateDatabase,
  call: McpCall,
): Promise<void> {
  await database
    .prepare(
      `INSERT INTO mcp_calls
        (at, tool, query, narrowed, classes, client, results, top_score,
         documents, fetched, characters, latency_ms, stale)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      call.at,
      call.tool,
      call.query === null ? null : recordedQuery(call.query),
      call.narrowed ? 1 : 0,
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
  readonly log: StateLog;
}): McpCallRecorder {
  const failed = (error: unknown) => {
    log({
      event: 'state-write-failed',
      table: 'mcp_calls',
      error: failureMessage(error),
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

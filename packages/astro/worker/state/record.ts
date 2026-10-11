/**
 * What every record of use shares (ADR-050, ADR-051): how its query is cut,
 * and how a failure to keep it is logged.
 */

/** Structured events; never an address, a token or a document. */
export type StateLog = (event: Readonly<Record<string, unknown>>) => void;

const QUERY_CHARACTERS = 200;
/** At most this much of a failure's message is logged. */
const MESSAGE_CHARACTERS = 200;

/**
 * A query as it is kept: its first 200 characters, never half of one, with
 * control characters as spaces, so that none reaches a terminal that prints
 * it. The text is cut to twice that in UTF-16 units first, which holds at
 * least 200 characters, so a long query is never copied whole.
 */
export function recordedQuery(query: string): string {
  return Array.from(plainText(query.slice(0, QUERY_CHARACTERS * 2)))
    .slice(0, QUERY_CHARACTERS)
    .join('');
}

/** Text without control characters: each is a space. */
function plainText(text: string): string {
  return text.replace(/\p{Cc}/gu, ' ');
}

/**
 * What a log event says of a failure. D1 names the table or the constraint
 * that failed, never a bound value: a missing migration shows up here as
 * "no such table".
 */
export function failureMessage(error: unknown): string {
  return error instanceof Error
    ? error.message.slice(0, MESSAGE_CHARACTERS)
    : 'unknown';
}

/**
 * Hands each write to `schedule`, which the Worker's entry backs with
 * `waitUntil`, and logs one that fails, by its table: neither a write that
 * fails nor one that throws reaches the caller.
 */
export function backgroundWriter<Row>({
  table,
  write,
  schedule,
  log,
}: {
  readonly table: string;
  readonly write: (row: Row) => Promise<void>;
  readonly schedule: (write: Promise<void>) => void;
  readonly log: StateLog;
}): (row: Row) => void {
  const failed = (error: unknown) => {
    log({ event: 'state-write-failed', table, error: failureMessage(error) });
  };
  return (row) => {
    try {
      schedule(write(row).catch(failed));
    } catch (error: unknown) {
      failed(error);
    }
  };
}

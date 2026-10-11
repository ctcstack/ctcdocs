/**
 * The Worker's database of operational state (ADR-050), as far as the Worker
 * uses one: SQL statements with bound values, run alone or as one
 * transaction.
 *
 * A D1 binding is one as it stands. The unit tests use SQLite in memory with
 * the same migrations, so the SQL the Worker runs is the SQL they run, and
 * `pnpm verify` applies the migrations to a local D1 and tries its checks
 * there, since D1's SQLite has limits of its own. Nothing here admits a
 * reader to anything, and no row names one.
 */

/** A value bound to a statement. */
export type StateValue = string | number | null;

export interface StateResult {
  readonly meta: { readonly changes: number };
}

export interface StateStatement {
  bind(...values: StateValue[]): StateStatement;
  run(): Promise<StateResult>;
}

export interface StateDatabase {
  prepare(query: string): StateStatement;
  /** Runs the statements in order as one transaction. */
  batch(statements: StateStatement[]): Promise<StateResult[]>;
}

/**
 * The database of operational state in memory: SQLite, with the platform's
 * migrations applied in order, behind the interface the Worker uses. The
 * stand-in for D1 in the unit tests, so the SQL they run is the Worker's.
 * Never bundled into the Worker, nor published.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import type {
  StateDatabase,
  StateResult,
  StateStatement,
  StateValue,
} from './database.js';

const MIGRATIONS = new URL('./migrations/', import.meta.url);

/** The migrations' file names, in the order Wrangler applies them. */
export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

class MemoryStatement implements StateStatement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly query: string,
    private readonly values: readonly StateValue[] = [],
  ) {}

  bind(...values: StateValue[]): StateStatement {
    return new MemoryStatement(this.database, this.query, values);
  }

  runNow(): StateResult {
    const { changes } = this.database.prepare(this.query).run(...this.values);
    return { meta: { changes: Number(changes) } };
  }

  async run(): Promise<StateResult> {
    return this.runNow();
  }

  async all(): Promise<{ results: unknown[] }> {
    return {
      results: this.database.prepare(this.query).all(...this.values),
    };
  }
}

export class MemoryDatabase implements StateDatabase {
  readonly sqlite = new DatabaseSync(':memory:');

  constructor() {
    for (const name of migrationFiles()) {
      this.sqlite.exec(readFileSync(new URL(name, MIGRATIONS), 'utf8'));
    }
  }

  prepare(query: string): StateStatement {
    return new MemoryStatement(this.sqlite, query);
  }

  /** As D1 does: in order, and all or nothing. */
  async batch(statements: StateStatement[]): Promise<StateResult[]> {
    this.sqlite.exec('BEGIN');
    try {
      const results = statements.map((statement) =>
        (statement as MemoryStatement).runNow(),
      );
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}

/** Every row of a table, in the order it was written. */
export function rowsOf(
  database: MemoryDatabase,
  table: 'mcp_calls' | 'site_searches' | 'reports',
): Record<string, unknown>[] {
  const order = table === 'reports' ? 'week' : 'id';
  return database.sqlite
    .prepare(`SELECT * FROM ${table} ORDER BY ${order}`)
    .all() as Record<string, unknown>[];
}

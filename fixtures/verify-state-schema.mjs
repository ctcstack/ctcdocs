/**
 * Applies the platform's state migrations to a local D1 and tries their
 * checks there (ADR-050).
 *
 * The unit tests run the migrations on Node's SQLite, which is not D1's: D1
 * caps the length of a GLOB pattern, for one, and a check SQLite accepts can
 * then refuse every row on D1, so that each write is dropped. Here the rows a
 * Worker writes must be kept, and rows the checks exist to refuse must be
 * refused, on the SQLite that runs in production.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('./project/', import.meta.url));
// Run by Node itself, so it starts on every platform the same way.
const wrangler = join(
  project,
  'node_modules',
  'wrangler',
  'bin',
  'wrangler.js',
);
const persist = mkdtempSync(join(tmpdir(), 'ctcdocs-state-'));

const AT = "'2026-10-12T09:30:00.000Z'";
const call = ({
  at = AT,
  query = "'leave policy'",
  classes = `'["3f177bba","members"]'`,
  documents = `'["a1b2c3","d4e5f6"]'`,
} = {}) =>
  `INSERT INTO mcp_calls (at, tool, query, narrowed, classes, client, results,
     top_score, documents, fetched, characters, latency_ms, stale)
   VALUES (${at}, 'search', ${query}, 0, ${classes}, 'Claude', 2, 0.71,
     ${documents}, 'a1b2c3', 1800, 420, 0);`;
const report = (week) =>
  `INSERT INTO reports (week, at, report) VALUES ('${week}', ${AT}, '{}');`;

/** Rows a Worker writes, which every check must keep. */
const KEPT = [
  call(),
  `INSERT INTO site_searches (at, query, classes, results, opened)
   VALUES (${AT}, 'leave policy', '["members"]', 0, '/handbook/');`,
  report('2026-10-05'),
  // Retention's statements, as the schedule runs them: a report goes by the
  // Monday of its week, against a cutoff in time.
  `DELETE FROM mcp_calls WHERE at < '2026-01-01T00:00:00.000Z';`,
  `DELETE FROM reports WHERE week < '2026-01-01T00:00:00.000Z';`,
];

/** Rows the checks exist to refuse, each on its own. */
const REFUSED = {
  'a time that would not sort as text': call({ at: "'2026-10-12T09:30:00Z'" }),
  'text where a short ID belongs': call({
    documents: `'["a1b2c3",{"text":"a document"}]'`,
  }),
  'an address where a class belongs': call({
    classes: `'["team@example.com"]'`,
  }),
  'a query past 200 characters': call({ query: `'${'q'.repeat(201)}'` }),
  'a week that is not a Monday': report('2026-10-11'),
};

const run = (args) =>
  execFileSync(
    process.execPath,
    [
      wrangler,
      ...args,
      '--env',
      'production',
      '--local',
      '--persist-to',
      persist,
    ],
    { cwd: project, stdio: 'pipe', encoding: 'utf8' },
  );

try {
  run(['d1', 'migrations', 'apply', 'KB_STATE_DB']);
  run(['d1', 'execute', 'KB_STATE_DB', '--command', KEPT.join('\n')]);
  const accepted = Object.entries(REFUSED).filter(([, statement]) => {
    try {
      run(['d1', 'execute', 'KB_STATE_DB', '--command', statement]);
      return true;
    } catch (error) {
      // Refused by a check, and by nothing else: a failure of Wrangler
      // itself must not pass for one.
      const output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
      if (!/CHECK constraint failed/u.test(output)) {
        throw error;
      }
      return false;
    }
  });
  if (accepted.length > 0) {
    throw new Error(
      `D1 kept rows its checks should refuse: ${accepted.map(([name]) => name).join('; ')}`,
    );
  }
  console.log(
    `State schema checked on D1: ${KEPT.length} statements kept, ${Object.keys(REFUSED).length} rows refused.`,
  );
} finally {
  rmSync(persist, { recursive: true, force: true });
}

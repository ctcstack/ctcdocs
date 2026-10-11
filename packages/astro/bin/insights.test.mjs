import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  candidateQuestions,
  inlineValues,
  InsightsError,
  parseInsightsArguments,
  runInsights,
} from './insights.mjs';

const PROJECT = fileURLToPath(
  new URL('../../../fixtures/project/', import.meta.url),
);
const MIGRATIONS = new URL('../worker/state/migrations/', import.meta.url);
/** Monday 12 October 2026: last week began on the 5th. */
const NOW = Date.parse('2026-10-12T09:00:00.000Z');

/** A database with the platform's migrations, and its rows as Wrangler gives them. */
function database() {
  const sqlite = new DatabaseSync(':memory:');
  for (const name of readdirSync(MIGRATIONS).sort()) {
    sqlite.exec(readFileSync(new URL(name, MIGRATIONS), 'utf8'));
  }
  const commands = [];
  const execute = async (command) => {
    commands.push(command);
    return sqlite.prepare(command).all();
  };
  return { sqlite, execute, commands };
}

function insertCall(
  sqlite,
  { at = '2026-10-07T10:00:00.000Z', query, results = 0 },
) {
  sqlite
    .prepare(
      `INSERT INTO mcp_calls (at, tool, query, narrowed, classes, client,
         results, top_score, documents, fetched, characters, latency_ms, stale)
       VALUES (?, 'search', ?, 0, '["members"]', 'Claude', ?, NULL, '[]',
         NULL, 120, 300, 0)`,
    )
    .run(at, query, results);
}

test('a value is written into SQL as the literal it is, quotes and all', () => {
  const { sqlite } = database();
  const tricky = "O'Brien'); DROP TABLE mcp_calls; --";
  const command = inlineValues("SELECT ? AS a, ? AS b, ? AS c, '?' AS d", [
    tricky,
    3.5,
    null,
  ]);
  assert.deepEqual(
    { ...sqlite.prepare(command).get() },
    { a: tricky, b: 3.5, c: null, d: '?' },
  );
  assert.ok(sqlite.prepare('SELECT count(*) AS n FROM mcp_calls').get());
  assert.throws(() => inlineValues('SELECT ?', []), InsightsError);
  assert.throws(() => inlineValues('SELECT 1', [1]), InsightsError);
  assert.throws(() => inlineValues('SELECT ?', [Number.NaN]), InsightsError);
});

test('the arguments name a Monday, or none', () => {
  assert.equal(parseInsightsArguments([]).env, 'production');
  assert.equal(
    parseInsightsArguments(['--week', '2026-10-05']).week,
    '2026-10-05',
  );
  assert.throws(
    () => parseInsightsArguments(['--week', '2026-10-06']),
    /Monday/u,
  );
  assert.throws(() => parseInsightsArguments(['--weeks', '1']), /Usage/u);
});

test("makes last week's report from its records, and reads only", async () => {
  const { sqlite, execute, commands } = database();
  insertCall(sqlite, { query: 'parking permit' });
  insertCall(sqlite, { query: 'Parking permit?' });
  insertCall(sqlite, { query: 'vacation policy', results: 2 });
  insertCall(sqlite, { at: '2026-10-12T08:00:00.000Z', query: 'this week' });
  let printed = '';
  const report = await runInsights([], {
    cwd: PROJECT,
    now: NOW,
    execute,
    write: (text) => {
      printed += text;
    },
  });
  assert.equal(report.week, '2026-10-05');
  assert.match(printed, /Insights for the week of 2026-10-05/u);
  assert.match(printed, /2× parking permit/u);
  assert.match(printed, /Not found: MCP 2 of 3 searches \(66\.7%\)/u);
  assert.doesNotMatch(printed, /this week/u);
  for (const command of commands) {
    assert.match(command, /^\s*SELECT/u);
  }
});

test('prints the kept report unless asked to make one now', async () => {
  const { sqlite, execute } = database();
  insertCall(sqlite, { query: 'parking permit' });
  const kept = {
    version: 1,
    week: '2026-10-05',
    from: '2026-10-05T00:00:00.000Z',
    to: '2026-10-12T00:00:00.000Z',
    made: '2026-10-12T00:05:00.000Z',
    records: { mcpCalls: 9, siteSearches: 0, truncated: false },
    marker: 'kept',
  };
  sqlite
    .prepare('INSERT INTO reports (week, at, report) VALUES (?, ?, ?)')
    .run(kept.week, kept.made, JSON.stringify(kept));
  let printed = '';
  const write = (text) => {
    printed += text;
  };
  await runInsights(['--json'], { cwd: PROJECT, now: NOW, execute, write });
  assert.equal(JSON.parse(printed).marker, 'kept');

  printed = '';
  await runInsights(['--json', '--compute'], {
    cwd: PROJECT,
    now: NOW,
    execute,
    write,
  });
  assert.equal(JSON.parse(printed).records.mcpCalls, 1);
});

test('writes misses as candidate questions, never into the evaluation set', async () => {
  const { sqlite, execute } = database();
  insertCall(sqlite, { query: 'parking permit' });
  insertCall(sqlite, { query: 'Parking permit?' });
  const directory = await mkdtemp(join(tmpdir(), 'ctcdocs-insights-'));
  try {
    const target = join(directory, 'candidates.json');
    await runInsights(['--questions', target], {
      cwd: PROJECT,
      now: NOW,
      execute,
      write: () => undefined,
    });
    const written = JSON.parse(await readFile(target, 'utf8'));
    assert.equal(written.week, '2026-10-05');
    assert.deepEqual(written.questions, [
      {
        id: '2026-10-05-m01',
        kind: 'miss',
        lang: null,
        query: 'parking permit',
        primary: null,
        expected: [],
        asked: 2,
        variants: ['Parking permit?'],
      },
    ]);
    await assert.rejects(
      runInsights(
        ['--questions', join(PROJECT, 'evaluation', 'search-questions.json')],
        { cwd: PROJECT, now: NOW, execute, write: () => undefined },
      ),
      /never into evaluation\/search-questions\.json/u,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('says so for a week with no record, and refuses an unknown environment', async () => {
  const { execute } = database();
  let printed = '';
  const report = await runInsights([], {
    cwd: PROJECT,
    now: NOW,
    execute,
    write: (text) => {
      printed += text;
    },
  });
  assert.equal(report, undefined);
  assert.match(printed, /No record of use in the week of 2026-10-05/u);
  await assert.rejects(
    runInsights(['--env', 'staging'], { cwd: PROJECT, now: NOW, execute }),
    /--env names an environment/u,
  );
});

test('a candidate is the label of its group, with what else was asked', () => {
  const made = candidateQuestions({
    week: '2026-10-05',
    notFound: [
      {
        label: 'a',
        count: 3,
        queries: [
          { query: 'a', count: 2 },
          { query: 'b', count: 1 },
        ],
      },
    ],
  });
  assert.deepEqual(made.questions[0], {
    id: '2026-10-05-m01',
    kind: 'miss',
    lang: null,
    query: 'a',
    primary: null,
    expected: [],
    asked: 3,
    variants: ['b'],
  });
});

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
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
    let printed = '';
    let noted = '';
    await runInsights(['--json', '--questions', target], {
      cwd: PROJECT,
      now: NOW,
      execute,
      write: (text) => {
        printed += text;
      },
      note: (text) => {
        noted += text;
      },
    });
    // The report alone on the output, one JSON document; the note beside it.
    assert.equal(JSON.parse(printed).week, '2026-10-05');
    assert.match(noted, /Wrote 1 candidate questions/u);
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
    // However the path names the set, and before anything is read: a
    // project of its own holds an evaluation set, and a link to its folder.
    const project = join(directory, 'project');
    await mkdir(join(project, 'evaluation'), { recursive: true });
    await copyFile(
      join(PROJECT, 'site.config.json'),
      join(project, 'site.config.json'),
    );
    const link = join(directory, 'evaluation-link');
    await symlink(join(project, 'evaluation'), link);
    const reads = [];
    for (const path of [
      join(project, 'evaluation', 'search-questions.json'),
      join(project, 'Evaluation', 'Search-Questions.json'),
      join(project, 'evaluation', '..', 'evaluation', 'search-questions.json'),
      join(link, 'search-questions.json'),
    ]) {
      await assert.rejects(
        runInsights(['--questions', path], {
          cwd: project,
          now: NOW,
          execute: async (command) => {
            reads.push(command);
            return [];
          },
          write: () => undefined,
        }),
        /never into evaluation\/search-questions\.json/u,
      );
    }
    assert.deepEqual(reads, []);

    // An evaluation set that is itself a link: its real file is the set.
    const linked = join(directory, 'linked');
    await mkdir(join(linked, 'evaluation'), { recursive: true });
    await copyFile(
      join(PROJECT, 'site.config.json'),
      join(linked, 'site.config.json'),
    );
    const real = join(directory, 'questions-kept-elsewhere.json');
    await writeFile(real, '{"questions":[]}\n');
    await symlink(real, join(linked, 'evaluation', 'search-questions.json'));
    for (const path of [
      real,
      join(linked, 'evaluation', 'search-questions.json'),
    ]) {
      await assert.rejects(
        runInsights(['--questions', path], {
          cwd: linked,
          now: NOW,
          execute,
          write: () => undefined,
        }),
        /never into evaluation\/search-questions\.json/u,
      );
    }
    assert.equal(await readFile(real, 'utf8'), '{"questions":[]}\n');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('says so for a week with no record, and refuses an unknown environment', async () => {
  const { execute } = database();
  let printed = '';
  let noted = '';
  const report = await runInsights([], {
    cwd: PROJECT,
    now: NOW,
    execute,
    write: (text) => {
      printed += text;
    },
    note: (text) => {
      noted += text;
    },
  });
  assert.equal(report, undefined);
  assert.equal(printed, '');
  assert.match(noted, /No record of use in the week of 2026-10-05/u);
  await assert.rejects(
    runInsights(['--env', 'staging'], { cwd: PROJECT, now: NOW, execute }),
    /--env names an environment/u,
  );
});

test('prints no control character a query holds', async () => {
  const { sqlite, execute } = database();
  insertCall(sqlite, { query: 'clip\u001b]52;c;cGF5bG9hZA==\u0007board' });
  let printed = '';
  await runInsights(['--compute'], {
    cwd: PROJECT,
    now: NOW,
    execute,
    write: (text) => {
      printed += text;
    },
  });
  assert.ok(printed.includes('1× clip ]52;c;cGF5bG9hZA== board'));
  // Line ends only.
  assert.ok(
    [...printed].every(
      (character) => character === '\n' || !/\p{Cc}/u.test(character),
    ),
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

/**
 * Prints a week's insights report (ADR-051) from a deployment's database,
 * and can write the week's misses as candidate questions for its
 * evaluation set.
 *
 *   ctcdocs-insights [--week <Monday, YYYY-MM-DD>] [--env <name>] [--local]
 *                    [--compute] [--json] [--questions <file>]
 *
 * It reads the database through the project's own Wrangler, as the
 * maintainer running it is signed in: `wrangler d1 execute KB_STATE_DB
 * --remote`, or `--local` for the development database. It only reads. The
 * kept report is printed unless `--compute` asks for one made now from the
 * week's records, with the project's settings; a week with no kept report
 * is made from its records anyway.
 *
 * Documents are named by their titles from the last build's access map
 * when there is one, and by short ID otherwise. Candidate questions go to a
 * file of their own, never into the evaluation set: each needs an editor to
 * say which documents answer it.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import {
  findProjectRoot,
  loadSiteConfiguration,
  PLATFORM_WORKERS,
  PROJECT_LAYOUT,
} from '@ctcstack/ctcdocs-core';

import {
  keptReport,
  lastWeek,
  makeReport,
  weekFrom,
} from '../dist-node/worker/insights/weekly.js';
import { stopWordsFor } from '../dist-node/worker/insights/words.js';

const USAGE =
  'Usage: ctcdocs-insights [--week <Monday, YYYY-MM-DD>] [--env <name>] [--local] [--compute] [--json] [--questions <file>]';
/** The evaluation set the questions are candidates for, never written. */
const EVALUATION_SET = 'evaluation/search-questions.json';
const PRINTED_GROUPS = 20;

export class InsightsError extends Error {
  name = 'InsightsError';
}

export function parseInsightsArguments(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        week: { type: 'string' },
        env: { type: 'string', default: 'production' },
        local: { type: 'boolean', default: false },
        compute: { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        questions: { type: 'string' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    throw new InsightsError(USAGE);
  }
  if (values.week !== undefined) {
    try {
      weekFrom(values.week);
    } catch {
      throw new InsightsError(
        `--week takes the Monday a week begins, as YYYY-MM-DD: ${values.week}`,
      );
    }
  }
  return values;
}

/** A value written into SQL as a literal, for a command that binds none. */
export function sqlLiteral(value) {
  if (value === null) {
    return 'NULL';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new InsightsError('A number bound to a query must be finite.');
    }
    return String(value);
  }
  if (typeof value === 'string') {
    return `'${value.replaceAll("'", "''")}'`;
  }
  throw new InsightsError(`A value of type ${typeof value} cannot be bound.`);
}

/**
 * The query with each `?` outside a quoted string replaced by its value,
 * in order: `wrangler d1 execute` takes a command, not bound values.
 */
export function inlineValues(query, values) {
  let at = 0;
  let quoted = false;
  let text = '';
  for (const character of query) {
    if (character === "'") {
      quoted = !quoted;
    }
    if (character === '?' && !quoted) {
      if (at >= values.length) {
        throw new InsightsError('A query has more places than values.');
      }
      text += sqlLiteral(values[at]);
      at += 1;
    } else {
      text += character;
    }
  }
  if (at !== values.length) {
    throw new InsightsError('A query has fewer places than values.');
  }
  return text;
}

/**
 * The state database as the Worker's interface reads it, through a
 * function that runs one SQL command and returns its rows. Only reads.
 */
export function commandDatabase(execute) {
  const statement = (query, values = []) => ({
    bind: (...bound) => statement(query, bound),
    all: async () => ({ results: await execute(inlineValues(query, values)) }),
    run: () =>
      Promise.reject(new InsightsError('ctcdocs-insights only reads.')),
  });
  return {
    prepare: (query) => statement(query),
    batch: () =>
      Promise.reject(new InsightsError('ctcdocs-insights only reads.')),
  };
}

/** Runs SQL against the environment's database with the project's Wrangler. */
function wranglerExecute({ projectRoot, env, local }) {
  const require = createRequire(join(projectRoot, 'package.json'));
  let wrangler;
  try {
    wrangler = join(
      dirname(require.resolve('wrangler/package.json')),
      'bin',
      'wrangler.js',
    );
  } catch {
    throw new InsightsError(
      'Wrangler is not installed in this project: it reads the database.',
    );
  }
  return async (command) => {
    const output = execFileSync(
      process.execPath,
      [
        wrangler,
        'd1',
        'execute',
        PLATFORM_WORKERS.stateDatabaseBinding,
        '--env',
        env,
        local ? '--local' : '--remote',
        '--json',
        '--command',
        command,
      ],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        // A busy week is tens of megabytes of JSON.
        maxBuffer: 512 * 1024 * 1024,
      },
    );
    const parsed = JSON.parse(output);
    return Array.isArray(parsed) ? (parsed[0]?.results ?? []) : [];
  };
}

/** Titles by short ID, from the last build's access map when there is one. */
async function documentTitles(projectRoot) {
  const path = resolve(projectRoot, PROJECT_LAYOUT.accessMapFile);
  if (!existsSync(path)) {
    return new Map();
  }
  const map = JSON.parse(await readFile(path, 'utf8'));
  return new Map(
    (map.agents?.documents ?? []).map((document) => [
      document.id,
      document.title,
    ]),
  );
}

/** Each of the week's misses as a question an editor completes. */
export function candidateQuestions(report) {
  return {
    about: `Searches people and assistants could not find in the week of ${report.week}, from ctcdocs-insights. Each is a candidate for the evaluation set: say which documents answer it (\`expected\`, \`primary\`) and its language before moving it there; an empty \`expected\` there means nothing in the corpus answers it.`,
    week: report.week,
    questions: report.notFound.map((group, index) => ({
      id: `${report.week}-m${String(index + 1).padStart(2, '0')}`,
      kind: 'miss',
      lang: null,
      query: group.label,
      primary: null,
      expected: [],
      asked: group.count,
      variants: group.queries
        .map((entry) => entry.query)
        .filter((query) => query !== group.label),
    })),
  };
}

const percent = (share) =>
  share === null ? 'none' : `${Math.round(share * 1000) / 10}%`;

/** Text as a terminal shows it: no control character reaches it. */
const shown = (text) => String(text).replace(/[\p{Cc}\u2028\u2029]/gu, ' ');

/** The report as a maintainer reads it in a terminal. */
export function formatReport(report, titles = new Map()) {
  const name = (id) => shown(titles.has(id) ? `${titles.get(id)} (${id})` : id);
  const { use } = report;
  const lines = [
    `Insights for the week of ${report.week} (${report.from} to ${report.to}), made ${report.made}`,
    `Records: ${report.records.mcpCalls} MCP calls, ${report.records.siteSearches} site searches${report.records.truncated ? ' (more than the report read)' : ''}${report.records.unreadable ? `; ${report.records.unreadable} could not be read` : ''}`,
    '',
    'Use',
    `  Calls: ${Object.entries(use.calls)
      .map(([tool, count]) => `${tool} ${count}`)
      .join(', ')}`,
    `  Clients: ${use.clients.map((entry) => `${shown(entry.client ?? 'unnamed')} ${entry.calls}`).join(', ') || 'none'}`,
    `  Search latency: median ${use.searchLatencyMs.median ?? '-'} ms, 95th percentile ${use.searchLatencyMs.p95 ?? '-'} ms`,
    `  Characters per answer (median): ${Object.entries(use.characters)
      .map(([tool, count]) => `${tool} ${count ?? '-'}`)
      .join(', ')}`,
    `  Not found: MCP ${use.notFound.mcp.notFound} of ${use.notFound.mcp.searches} searches (${percent(use.notFound.mcp.share)}), site ${use.notFound.site.notFound} of ${use.notFound.site.searches} (${percent(use.notFound.site.share)})`,
    `  Weak line: ${report.weakLine.configured ?? `the week's lowest fifth, up to ${report.weakLine.relative ?? '-'}`}; ${use.narrowed} narrowed and ${use.blank} blank searches not counted`,
    '',
    'What people could not find',
    ...(report.notFound.length === 0
      ? ['  Nothing.']
      : report.notFound.slice(0, PRINTED_GROUPS).flatMap((group) => [
          `  ${group.count}× ${shown(group.label)}${group.site > 0 ? ` (site ${group.site})` : ''}`,
          ...(group.queries.length > 1
            ? [
                `      also: ${group.queries
                  .filter((entry) => entry.query !== group.label)
                  .map((entry) => shown(entry.query))
                  .join(' | ')}`,
              ]
            : []),
          ...(group.documents.length > 0
            ? [
                `      nearly: ${group.documents.map((entry) => name(entry.id)).join(', ')}`,
              ]
            : []),
        ])),
    '',
    'Asked most',
    ...(report.askedMost.length === 0
      ? ['  Nothing.']
      : report.askedMost.map(
          (group) => `  ${group.count}× ${shown(group.label)}`,
        )),
    '',
    'Found, not read',
    ...(report.foundNotRead.length === 0
      ? ['  Nothing.']
      : report.foundNotRead.map(
          (entry) =>
            `  ${name(entry.id)}: returned ${entry.appearances}×, read ${entry.fetches}×`,
        )),
  ];
  return `${lines.join('\n')}\n`;
}

/** Writes beside the target, then renames, so a failed run leaves the last file. */
async function writeAtomically(path, text) {
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, text);
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function runInsights(
  argv,
  {
    cwd = process.cwd(),
    now = Date.now(),
    execute,
    write = (text) => process.stdout.write(text),
    note = (text) => process.stderr.write(text),
  } = {},
) {
  const options = parseInsightsArguments(argv);
  const projectRoot = findProjectRoot(cwd);
  // Refused before anything is read, so a wrong path costs nothing.
  const target = options.questions
    ? questionsTarget(resolve(cwd, options.questions), projectRoot)
    : undefined;
  const site = loadSiteConfiguration(projectRoot);
  if (!Object.hasOwn(site.deployment.environments, options.env)) {
    throw new InsightsError(
      `--env names an environment of ${PROJECT_LAYOUT.configurationFile}: ${Object.keys(site.deployment.environments).sort().join(', ')}`,
    );
  }
  const database = commandDatabase(
    execute ??
      wranglerExecute({ projectRoot, env: options.env, local: options.local }),
  );
  const week = options.week ? weekFrom(options.week) : lastWeek(now);
  const report =
    (!options.compute && (await keptReport(database, week.week))) ||
    (await makeReport({
      database,
      week,
      now,
      settings: {
        weakScore: site.insights?.weakScore,
        stopWords: stopWordsFor(site.mcp?.language),
      },
    }));
  if (!report) {
    note(`No record of use in the week of ${week.week}.\n`);
    return undefined;
  }
  write(
    options.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : formatReport(report, await documentTitles(projectRoot)),
  );
  if (target) {
    await writeAtomically(
      target,
      `${JSON.stringify(candidateQuestions(report), null, 2)}\n`,
    );
    // Beside the report, never in it: `--json` stays one document.
    note(
      `Wrote ${report.notFound.length} candidate questions to ${relative(cwd, target) || target}.\n`,
    );
  }
  return report;
}

/** The real place of a path whose file may not exist yet: its folder's. */
function realPlace(path) {
  let folder = dirname(path);
  const rest = [basename(path)];
  while (!existsSync(folder) && dirname(folder) !== folder) {
    rest.unshift(basename(folder));
    folder = dirname(folder);
  }
  return join(realpathSync(folder), ...rest);
}

/**
 * Where candidates go: anywhere but the evaluation set itself, however the
 * path names it, through a link or in another case.
 */
function questionsTarget(target, projectRoot) {
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  if (
    same(realPlace(target), realPlace(resolve(projectRoot, EVALUATION_SET)))
  ) {
    throw new InsightsError(
      `--questions writes candidates beside the evaluation set, never into ${EVALUATION_SET}.`,
    );
  }
  return target;
}

function isMain() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  runInsights(process.argv.slice(2)).catch((error) => {
    // Wrangler says why it could not read; nothing else is printed of it.
    process.stderr.write(
      `${error instanceof InsightsError ? error.message : `ctcdocs-insights failed: ${error.stderr || error.message}`}\n`,
    );
    process.exitCode = 1;
  });
}

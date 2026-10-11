/**
 * Measures the MCP server's search against a project's own questions, and
 * writes what it found to `evaluation/results/<date>-<label>/` in the
 * project, so that each run stays in its history (ADR-042, ADR-044).
 *
 * It calls the project's AI Search instance through the Worker's own search,
 * `searchDocuments`, with the settings and classes of the last build's access
 * map, so it measures exactly what an assistant is shown: which documents, in
 * which order, and which passages of them. Each variant changes one setting
 * from what is built. AI Search's cache is turned off for every request.
 *
 *   pnpm build
 *   ctcdocs-eval-search --label <what-changed> [--instance <name>]
 *
 * The questions are the project's, in `evaluation/search-questions.json`:
 *
 *   { "questions": [{ "id", "lang", "kind", "query",
 *                     "primary": "<short ID>" | null,
 *                     "expected": ["<short ID>", ...],
 *                     "answers": ["<words the answer holds>", ...] }] }
 *
 * `answers` is optional: words a passage holds when it shows the answer, so a
 * run can tell a document found from an answer shown.
 *
 * Needs CLOUDFLARE_API_TOKEN with AI Search Read and Run, from the
 * environment or the project's `.env`; CLOUDFLARE_ACCOUNT_ID is read from
 * there too, or from the token. Nothing of a document's text is written: per
 * chunk, its document, its scores and its length; per search, whether an
 * answer was shown.
 */
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';

import { findProjectRoot, PROJECT_LAYOUT } from '@ctcstack/ctcdocs-core';

import { searchDocuments } from '../dist-node/worker/agents/documents.js';
import { searchFilter } from '../dist-node/worker/agents/search-filter.js';

const API = 'https://api.cloudflare.com/client/v4';
const QUESTIONS = 'evaluation/search-questions.json';
const RESULTS = 'evaluation/results';
const PARALLEL = 4;
/** Between two passages of one result, as the Worker joins them. */
const PASSAGE_SEPARATOR = '\n\n…\n\n';

export class EvaluationError extends Error {
  name = 'EvaluationError';
}

/** Each variant changes one search setting from what is built. */
export const VARIANTS = [
  { name: 'built', change: () => ({}) },
  {
    name: 'no-reranking',
    change: (s) => ({ reranking: { ...s.reranking, enabled: false } }),
  },
  {
    name: 'other-keyword-match',
    change: (s) => ({ keywordMatch: s.keywordMatch === 'or' ? 'and' : 'or' }),
  },
  {
    name: 'other-context-chunks',
    change: (s) => ({ contextChunks: s.contextChunks === 0 ? 1 : 0 }),
  },
  {
    name: 'reranking-threshold-0.005',
    change: (s) => ({ reranking: { ...s.reranking, threshold: 0.005 } }),
  },
  {
    name: 'reranking-threshold-0.01',
    change: (s) => ({ reranking: { ...s.reranking, threshold: 0.01 } }),
  },
  {
    name: 'results-5',
    change: (s) => ({ results: Math.min(5, s.chunks) }),
  },
  {
    name: 'results-15',
    change: (s) => ({ results: Math.min(15, s.chunks) }),
  },
];

/** Text compared without case, and with every run of spaces as one. */
const normalized = (text) =>
  text.toLocaleLowerCase('en').replace(/\s+/gu, ' ').trim();

/**
 * Whether the passages of the documents a question needs show its answer:
 * whether any of them holds any of the answer's words. Another document that
 * happens to hold them does not count. `null` when the question names none.
 */
export function answerShown(results, question) {
  if (!question.answers?.length) {
    return null;
  }
  const needed = new Set([question.primary, ...question.expected]);
  const wanted = question.answers.map(normalized);
  return results.some((result) => {
    if (!needed.has(result.id)) {
      return false;
    }
    const text = normalized(result.text ?? '');
    return wanted.some((answer) => text.includes(answer));
  });
}

/** The passages a result shows, and their characters. */
export function passagesOf(results) {
  let count = 0;
  let characters = 0;
  for (const result of results) {
    if (!result.text) {
      continue;
    }
    const passages = result.text.split(PASSAGE_SEPARATOR);
    count += passages.length;
    characters += passages.reduce((sum, passage) => sum + passage.length, 0);
  }
  return { count, characters };
}

/** One question's search under one variant, as an assistant is shown it. */
export function scored(question, results) {
  const ids = results.map((result) => result.id);
  const rank = question.primary ? ids.indexOf(question.primary) + 1 : 0;
  const recallOf = (listed) =>
    question.expected.length
      ? question.expected.filter((id) => listed.includes(id)).length /
        question.expected.length
      : null;
  return {
    rank: rank || null,
    recall: recallOf(ids.slice(0, 10)),
    recallListed: recallOf(ids),
    withText: results.filter((result) => result.text).length,
    answerShown: answerShown(results, question),
    documents: ids,
    passages: passagesOf(results),
  };
}

const mean = (values) =>
  values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
const fixed = (value, digits = 3) =>
  value === null ? null : Number(value.toFixed(digits));

/** What a set of runs found, over the questions they asked. */
export function metrics(rows, questions) {
  const byId = new Map(questions.map((question) => [question.id, question]));
  const asked = rows.filter((row) => byId.get(row.id)?.primary);
  const ranks = asked.map((row) => row.rank);
  const answered = rows.filter((row) => row.answerShown !== null);
  return {
    questions: asked.length,
    first: ranks.filter((rank) => rank === 1).length,
    top3: ranks.filter((rank) => rank && rank <= 3).length,
    top10: ranks.filter(Boolean).length,
    mrr: fixed(mean(ranks.map((rank) => (rank ? 1 / rank : 0)))),
    recallAt10: fixed(mean(asked.map((row) => row.recall))),
    recallListed: fixed(mean(asked.map((row) => row.recallListed))),
    answersShown: answered.filter((row) => row.answerShown).length,
    answersAsked: answered.length,
    documentsPerSearch: fixed(mean(rows.map((row) => row.documents.length)), 1),
    withTextPerSearch: fixed(mean(rows.map((row) => row.withText)), 1),
    passagesPerSearch: fixed(mean(rows.map((row) => row.passages.count)), 1),
    passageCharactersPerSearch: Math.round(
      mean(rows.map((row) => row.passages.characters)) ?? 0,
    ),
  };
}

/** The map with one variant's search settings. */
function withSearch(map, search) {
  return { ...map, agents: { ...map.agents, search } };
}

/**
 * Runs every question under every variant as a member, and under the built
 * settings as an admin too, through the Worker's search. `index` is asked as
 * the Worker asks AI Search; `chunksOf` reads what it last answered a query.
 */
export async function evaluate({ map, questions, index, origin }) {
  const built = map.agents.search;
  const readers = {
    member: { kind: 'person', sub: 'member', groups: [] },
    admin: { kind: 'person', sub: 'admin', groups: [map.admins[0]] },
  };
  const jobs = [
    ...VARIANTS.flatMap((variant) =>
      questions.map((question) => ({ variant, view: 'member', question })),
    ),
    ...(map.admins[0]
      ? questions.map((question) => ({
          variant: VARIANTS[0],
          view: 'admin',
          question,
        }))
      : []),
  ];
  const runs = new Array(jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: PARALLEL }, async () => {
      while (next < jobs.length) {
        const at = next++;
        const { variant, view, question } = jobs[at];
        const search = { ...built, ...variant.change(built) };
        const chunks = [];
        const access = {
          map: withSearch(map, search),
          reader: readers[view],
          stale: false,
          origin,
          store: undefined,
          index: {
            search: async (...args) => {
              const found = await index.search(...args);
              chunks.push(...found);
              return found;
            },
            sync: () => Promise.resolve(),
          },
        };
        const results = await searchDocuments(access, question.query);
        runs[at] = {
          variant: variant.name,
          view,
          id: question.id,
          ...scored(question, results),
          // Every chunk of what is built, for thresholds simulated later.
          ...(variant.name === 'built' && view === 'member'
            ? {
                chunks: chunks.map(({ key, class: cls, scores, length }) => ({
                  key,
                  class: cls,
                  ...scores,
                  length,
                })),
              }
            : {}),
        };
      }
    }),
  );
  return runs;
}

/** An AI Search instance asked over its REST API as the Worker asks it. */
function restIndex({ api, instancePath, classes }) {
  const round = (value) =>
    typeof value === 'number' ? Math.round(value * 10_000) / 10_000 : null;
  return {
    search: async (query, readable, settings, restriction) => {
      const filters = searchFilter(classes, readable, restriction);
      const result = await api(`${instancePath}/search`, {
        method: 'POST',
        body: JSON.stringify({
          query,
          ai_search_options: {
            cache: { enabled: false },
            retrieval: {
              max_num_results: settings.chunks,
              match_threshold: settings.vectorThreshold,
              keyword_match_mode: settings.keywordMatch,
              context_expansion: settings.contextChunks,
              ...(Object.keys(filters).length > 0 ? { filters } : {}),
            },
            reranking: {
              enabled: settings.reranking.enabled,
              model: settings.reranking.model,
              match_threshold: settings.reranking.threshold,
            },
          },
        }),
      });
      return (result.chunks ?? []).map((chunk) => {
        const cls = chunk.item.metadata?.class;
        return {
          key: chunk.item.key,
          text: chunk.text ?? '',
          class: typeof cls === 'string' ? cls : undefined,
          length: (chunk.text ?? '').length,
          scores: {
            score: round(chunk.score),
            vector: round(chunk.scoring_details?.vector_score),
            keyword: round(chunk.scoring_details?.keyword_score),
            reranking: round(chunk.scoring_details?.reranking_score),
          },
        };
      });
    },
  };
}

function cloudflareApi(token) {
  return async function api(path, init = {}) {
    for (let attempt = 0; ; attempt += 1) {
      const response = await fetch(`${API}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (response.ok) {
        return (await response.json()).result;
      }
      if (attempt < 3 && [429, 500, 502, 503, 504].includes(response.status)) {
        await new Promise((done) => setTimeout(done, 2000 * (attempt + 1)));
        continue;
      }
      throw new EvaluationError(
        `${init.method ?? 'GET'} ${path}: ${response.status}`,
      );
    }
  };
}

/** The project's `.env`, for values the environment does not set. */
async function loadProjectEnv(projectRoot) {
  const text = await readFile(resolve(projectRoot, '.env'), 'utf8').catch(
    () => '',
  );
  for (const [name, value] of Object.entries(parseEnv(text))) {
    if (process.env[name] === undefined) {
      process.env[name] = value;
    }
  }
}

/** The AI Search instance the project's Wrangler configuration binds. */
async function boundInstance(projectRoot) {
  const require = createRequire(resolve(projectRoot, 'package.json'));
  let wrangler;
  try {
    wrangler = await import(pathToFileURL(require.resolve('wrangler')).href);
  } catch {
    throw new EvaluationError(
      'Wrangler is not installed in the project; name the instance with --instance.',
    );
  }
  const config = wrangler.unstable_readConfig({
    config: resolve(projectRoot, 'wrangler.jsonc'),
    env: 'production',
  });
  return config.ai_search?.[0]?.instance_name;
}

const cell = (text) => String(text).replaceAll('|', '\\|');

function report({ name, questions, summary, runs, map }) {
  const title = (id) =>
    map.agents.documents.find((document) => document.id === id)?.title ?? id;
  const built = runs.filter(
    (row) => row.variant === 'built' && row.view === 'member',
  );
  return [
    `# Search measurement ${name}`,
    '',
    `${questions.length} questions, ${summary.documents} documents, as a ` +
      'member and, for the built settings, as an admin. Each variant changes ' +
      'one setting from what is built. Measured with ' +
      `\`ctcdocs-eval-search\` ${summary.platform}.`,
    '',
    '## Settings',
    '',
    '```json',
    JSON.stringify(
      { built: summary.built, instance: summary.instance },
      null,
      2,
    ),
    '```',
    '',
    '## Variants',
    '',
    '| Variant | Answer first | Top 3 | Top 10 | MRR | MRR ru | MRR en | Recall at 10 | Recall listed | Answers shown | Documents per search | With text | Passages per search | Passage characters per search |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...Object.entries(summary.variants).map(([variant, value]) =>
      [
        '',
        variant,
        `${value.all.first} of ${value.all.questions}`,
        value.all.top3,
        value.all.top10,
        value.all.mrr,
        value.ru?.mrr ?? '',
        value.en?.mrr ?? '',
        value.all.recallAt10,
        value.all.recallListed,
        value.all.answersAsked
          ? `${value.all.answersShown} of ${value.all.answersAsked}`
          : '',
        value.all.documentsPerSearch,
        value.all.withTextPerSearch,
        value.all.passagesPerSearch,
        value.all.passageCharactersPerSearch,
        '',
      ]
        .join(' | ')
        .trim(),
    ),
    '',
    '## Questions',
    '',
    `Rank of the answer under each variant (${VARIANTS.map((v) => v.name).join(', ')}); — when it is not among the results.`,
    '',
    '| ID | Language | Kind | Query | Answer | Ranks | Recall | Answer shown |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...summary.questions.map((row) => {
      const question = questions.find((q) => q.id === row.id);
      return `| ${row.id} | ${question.lang} | ${question.kind} | ${cell(question.query)} | ${
        question.primary ? cell(title(question.primary)) : 'none'
      } | ${Object.values(row.ranks)
        .map((rank) => rank ?? '—')
        .join(' / ')} | ${row.recall === null ? '' : fixed(row.recall, 2)} | ${
        row.answerShown === null ? '' : row.answerShown ? 'yes' : 'no'
      } |`;
    }),
    '',
    '## Missed under the built settings',
    '',
    ...built.flatMap((row) => {
      const question = questions.find((q) => q.id === row.id);
      const missing = question.expected.filter(
        (id) => !row.documents.includes(id),
      );
      return missing.length
        ? [
            `- ${row.id} “${cell(question.query)}”: ${missing.map((id) => `${cell(title(id))} (${id})`).join(', ')}`,
          ]
        : [];
    }),
    '',
    '## Found, but the answer not shown',
    '',
    ...built
      .filter((row) => row.answerShown === false && row.rank)
      .map((row) => {
        const question = questions.find((q) => q.id === row.id);
        return `- ${row.id} “${cell(question.query)}”: ${cell(title(question.primary))} ranked ${row.rank}`;
      }),
    '',
  ].join('\n');
}

export function summarize({ runs, questions, map, instance, platform }) {
  const variants = {};
  for (const variant of VARIANTS) {
    const rows = runs.filter(
      (row) => row.variant === variant.name && row.view === 'member',
    );
    variants[variant.name] = {
      change: variant.change(map.agents.search),
      all: metrics(rows, questions),
      ...Object.fromEntries(
        [...new Set(questions.map((question) => question.lang))]
          .sort()
          .map((lang) => [
            lang,
            metrics(
              rows.filter(
                (row) =>
                  questions.find((question) => question.id === row.id).lang ===
                  lang,
              ),
              questions,
            ),
          ]),
      ),
    };
  }
  const admin = runs.filter((row) => row.view === 'admin');
  if (admin.length > 0) {
    variants['built, admin view'] = {
      change: { reader: 'admin' },
      all: metrics(admin, questions),
    };
  }
  const builtRow = (id, name) =>
    runs.find(
      (row) => row.id === id && row.variant === name && row.view === 'member',
    );
  return {
    platform,
    instance,
    built: map.agents.search,
    documents: map.agents.documents.length,
    variants,
    questions: questions.map((question) => ({
      id: question.id,
      ranks: Object.fromEntries(
        VARIANTS.map((variant) => [
          variant.name,
          builtRow(question.id, variant.name).rank,
        ]),
      ),
      recall: builtRow(question.id, 'built').recall,
      answerShown: builtRow(question.id, 'built').answerShown,
    })),
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      label: { type: 'string', default: 'run' },
      // Another instance indexing the same bucket, to compare its indexing.
      instance: { type: 'string' },
    },
  });
  if (!/^[a-z0-9][a-z0-9.-]*$/u.test(values.label)) {
    throw new EvaluationError(
      '--label takes lowercase letters, digits, dots and dashes.',
    );
  }
  const projectRoot = findProjectRoot();
  await loadProjectEnv(projectRoot);
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    throw new EvaluationError('CLOUDFLARE_API_TOKEN is not set.');
  }
  const json = async (path) =>
    JSON.parse(await readFile(resolve(projectRoot, path), 'utf8'));
  if (!existsSync(resolve(projectRoot, PROJECT_LAYOUT.accessMapFile))) {
    throw new EvaluationError(
      `${PROJECT_LAYOUT.accessMapFile} is missing; run pnpm build first.`,
    );
  }
  const map = await json(PROJECT_LAYOUT.accessMapFile);
  if (!map.agents) {
    throw new EvaluationError(
      'The build has no MCP server; mcp.enabled is off.',
    );
  }
  if (!existsSync(resolve(projectRoot, QUESTIONS))) {
    throw new EvaluationError(`${QUESTIONS} is missing.`);
  }
  const { questions } = await json(QUESTIONS);
  const instanceName = values.instance ?? (await boundInstance(projectRoot));
  if (!instanceName) {
    throw new EvaluationError('wrangler.jsonc names no AI Search instance.');
  }
  const api = cloudflareApi(token);
  const account =
    process.env.CLOUDFLARE_ACCOUNT_ID || (await api('/accounts'))[0]?.id;
  const instancePath = `/accounts/${account}/ai-search/namespaces/default/instances/${instanceName}`;
  const origin =
    Object.values(map.site.environments)[0]?.origin ?? 'https://example.com';

  const runs = await evaluate({
    map,
    questions,
    origin,
    index: restIndex({
      api,
      instancePath,
      classes: Object.keys(map.classes),
    }),
  });
  const settings = await api(instancePath);
  const { version } = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  const summary = summarize({
    runs,
    questions,
    map,
    platform: version,
    instance: {
      name: instanceName,
      ...Object.fromEntries(
        [
          'embedding_model',
          'chunk_size',
          'chunk_overlap',
          'index_method',
          'fusion_method',
          'indexing_options',
        ].map((key) => [key, settings[key] ?? null]),
      ),
    },
  });

  const date = new Date().toISOString().slice(0, 10);
  const name = `${date}-${values.label}`;
  const target = resolve(projectRoot, RESULTS, name);
  if (existsSync(target)) {
    throw new EvaluationError(
      `${RESULTS}/${name} exists; choose another label.`,
    );
  }
  // Written whole or not at all: a run that fails leaves no partial result.
  const temporary = resolve(projectRoot, RESULTS, `.${name}.tmp`);
  await rm(temporary, { recursive: true, force: true });
  await mkdir(temporary, { recursive: true });
  await writeFile(
    resolve(temporary, 'summary.json'),
    `${JSON.stringify({ date, label: values.label, ...summary }, null, 2)}\n`,
  );
  await writeFile(resolve(temporary, 'runs.json'), `${JSON.stringify(runs)}\n`);
  await writeFile(
    resolve(temporary, 'README.md'),
    report({ name, questions, summary, runs, map }),
  );
  await rename(temporary, target);
  console.log(`${RESULTS}/${name}/`);
  console.table(
    Object.fromEntries(
      Object.entries(summary.variants).map(([variant, value]) => [
        variant,
        value.all,
      ]),
    ),
  );
}

/** Whether this module is the program being run, through a bin link too. */
function invokedDirectly() {
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

if (invokedDirectly()) {
  try {
    await main();
  } catch (error) {
    if (error instanceof EvaluationError) {
      console.error(`ERROR [EVAL_SEARCH]: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}

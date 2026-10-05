import assert from 'node:assert/strict';
import test from 'node:test';

import { MCP_DEFAULTS } from '@ctcstack/ctcdocs-core';

import {
  answerShown,
  evaluate,
  metrics,
  passagesOf,
  scored,
  summarize,
  VARIANTS,
} from './eval-search.mjs';

/* A synthetic project: two documents members read, one only admins read. */
const map = {
  site: {
    environments: {
      production: { origin: 'https://docs.example.com' },
    },
  },
  admins: ['admins@example.com'],
  classes: {
    members: { id: 'members', readers: '*' },
    admins: { id: 'admins', readers: [] },
  },
  files: {
    '/a/index.md': 'members',
    '/b/index.md': 'members',
    '/c/index.md': 'admins',
  },
  agents: {
    search: MCP_DEFAULTS.search,
    fetchCharacters: MCP_DEFAULTS.fetchCharacters,
    browseCharacters: MCP_DEFAULTS.browseCharacters,
    recent: MCP_DEFAULTS.recent,
    documents: ['a', 'b', 'c'].map((letter) => ({
      id: letter.repeat(6),
      title: `Document ${letter}`,
      markdown: `/${letter}/index.md`,
      modified: null,
      path: [],
      source: null,
      hash: `h-${letter}`,
    })),
  },
};

const chunk = (id, text, cls = 'members') => ({
  key: `docs/${id}.md`,
  text,
  class: cls,
  length: text.length,
  scores: { score: 0.5, vector: 0.5, keyword: 1, reranking: 0.5 },
});

/* An index that answers every query with the same chunks, as AI Search ranks. */
const index = {
  search: async (query, classes) =>
    [
      chunk('cccccc', 'The secret plan: admins only.', 'admins'),
      chunk('bbbbbb', 'Leave is requested in the HR portal.'),
      chunk('aaaaaa', 'Holidays are listed by country.'),
    ].filter((entry) => classes.includes(entry.class)),
};

const questions = [
  {
    id: 'q1',
    lang: 'en',
    kind: 'lookup',
    query: 'how to request leave',
    primary: 'bbbbbb',
    expected: ['bbbbbb', 'aaaaaa'],
    answers: ['HR  portal'],
  },
  {
    id: 'q2',
    lang: 'ru',
    kind: 'none',
    query: 'ничего',
    primary: null,
    expected: [],
  },
];

test('tells an answer shown from a document found', () => {
  const results = [
    { id: 'bbbbbb', text: 'Leave is requested\nin the HR portal.' },
  ];
  const asked = (answers) => ({
    primary: 'bbbbbb',
    expected: ['bbbbbb'],
    answers,
  });
  assert.equal(answerShown(results, asked(['hr portal'])), true);
  assert.equal(answerShown(results, asked(['payroll'])), false);
  assert.equal(answerShown([{ id: 'bbbbbb' }], asked(['hr portal'])), false);
  assert.equal(answerShown(results, asked(undefined)), null);
  // A document the question does not need, holding the words, does not count.
  assert.equal(
    answerShown(
      [{ id: 'zzzzzz', text: 'The HR portal.' }],
      asked(['hr portal']),
    ),
    false,
  );
});

test('counts the passages a search shows', () => {
  assert.deepEqual(
    passagesOf([{ text: 'One.\n\n…\n\nTwo.' }, { text: 'Three.' }, {}]),
    { count: 3, characters: 14 },
  );
});

test('scores a search by the rank of its answer and what it recalls', () => {
  const row = scored(questions[0], [
    { id: 'aaaaaa', text: 'Holidays.' },
    { id: 'bbbbbb', text: 'The HR portal.' },
  ]);
  assert.equal(row.rank, 2);
  assert.equal(row.recall, 1);
  assert.equal(row.recallListed, 1);
  assert.equal(row.withText, 2);
  assert.equal(row.answerShown, true);
  assert.equal(scored(questions[1], []).rank, null);
});

test('measures the Worker’s own search, as a member and as an admin', async () => {
  const runs = await evaluate({
    map,
    questions,
    index,
    origin: 'https://docs.example.com',
  });
  assert.equal(runs.length, VARIANTS.length * 2 + 2);
  const member = runs.find(
    (row) =>
      row.variant === 'built' && row.view === 'member' && row.id === 'q1',
  );
  // The admins' document is never shown to a member.
  assert.deepEqual(member.documents, ['bbbbbb', 'aaaaaa']);
  assert.equal(member.rank, 1);
  assert.equal(member.answerShown, true);
  const admin = runs.find((row) => row.view === 'admin' && row.id === 'q1');
  assert.deepEqual(admin.documents, ['cccccc', 'bbbbbb', 'aaaaaa']);
  // A variant changes the settings the Worker searches with.
  const five = runs.find(
    (row) => row.variant === 'results-5' && row.id === 'q1',
  );
  assert.equal(five.rank, 1);

  const summary = summarize({
    runs,
    questions,
    map,
    instance: { name: 'example' },
    platform: '0.0.0',
  });
  assert.equal(summary.variants.built.all.mrr, 1);
  assert.equal(summary.variants.built.all.answersShown, 1);
  assert.equal(summary.variants['built, admin view'].all.questions, 1);
  assert.deepEqual(Object.keys(summary.variants.built).sort(), [
    'all',
    'change',
    'en',
    'ru',
  ]);
});

test('writes no document text into a run', async () => {
  const runs = await evaluate({
    map,
    questions,
    index,
    origin: 'https://docs.example.com',
  });
  const written = JSON.stringify(runs);
  for (const text of ['secret plan', 'HR portal', 'Holidays are listed']) {
    assert.equal(written.includes(text), false, text);
  }
  const built = runs.find(
    (row) => row.variant === 'built' && row.view === 'member',
  );
  assert.deepEqual(Object.keys(built.chunks[0]).sort(), [
    'class',
    'key',
    'keyword',
    'length',
    'reranking',
    'score',
    'vector',
  ]);
});

test('reports nothing for questions it was not asked', () => {
  assert.deepEqual(metrics([], questions).questions, 0);
});

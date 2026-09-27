import { describe, expect, it } from 'vitest';

import { formatTitleReport } from './format-title-report.js';
import type { SourceTitleFacts } from './source-title.js';
import {
  classifyTitleMatch,
  createTitleReport,
  findMixedScriptHeadings,
  nameFeatures,
  recordedTitleFacts,
  serializeTitleReport,
  similarity,
  type TitleReportInput,
} from './title-report.js';

function facts(
  candidate?: SourceTitleFacts['candidate'],
  firstBlocks: SourceTitleFacts['firstBlocks'] = ['text'],
): SourceTitleFacts {
  return {
    firstBlocks,
    ...(candidate ? { candidate } : {}),
    titleCount: candidate?.style === 'title' ? 1 : 0,
    heading1Count: candidate?.style === 'heading-1' ? 1 : 0,
  };
}

function input(overrides: Partial<TitleReportInput> = {}): TitleReportInput {
  return {
    id: 'doc',
    slug: 'team/doc',
    name: '01 - Pricing',
    title: 'Pricing',
    source: facts(),
    removedTitleHeading: false,
    body: 'Body.\n',
    ...overrides,
  };
}

describe('how a document title relates to its file name', () => {
  it.each([
    ['Pricing handbook', 'Pricing handbook', 'identical'],
    ['pricing  HANDBOOK', 'Pricing handbook', 'normalized'],
    ['Team — Operating context', 'Team_Operating Context', 'normalized'],
    ['Rest API (Supplier Keys)', 'Supplier Keys', 'contains'],
    ['Webhooks', 'Webhooks - How it works', 'contained'],
    [
      'Team Stack Business Units RACI',
      'Team_Stack Business Unit RACI',
      'similar',
    ],
    ['General Information', 'Manual Responder Campaign Launch', 'different'],
  ] as const)('%s against %s is %s', (candidate, title, expected) => {
    expect(classifyTitleMatch(candidate, title).match).toBe(expected);
  });

  it('reports no match for a document without a title candidate', () => {
    expect(classifyTitleMatch(undefined, 'Pricing')).toEqual({
      match: 'none',
      similarity: null,
    });
  });

  it('scores similarity from 0 to 1, ignoring case and punctuation', () => {
    expect(similarity('Pricing', 'pricing')).toBe(1);
    expect(similarity('abc', 'xyz')).toBe(0);
    expect(similarity('Pricing handbook', 'Pricing — handbook')).toBe(1);
    expect(similarity('Pricing handbook', 'Pricing hand-book')).toBe(0.94);
  });
});

describe('what a file name carries besides a title', () => {
  it('notices order numbers, underscore prefixes and file extensions', () => {
    expect(nameFeatures('03 - Team_Stack_Handbook.docx')).toEqual({
      orderPrefix: true,
      underscorePrefix: true,
      underscores: true,
      fileExtension: true,
    });
    expect(nameFeatures('Pricing handbook')).toEqual({
      orderPrefix: false,
      underscorePrefix: false,
      underscores: false,
      fileExtension: false,
    });
  });
});

describe('headings that mix alphabets', () => {
  it('names the heading and the stray letter', () => {
    expect(
      findMixedScriptHeadings(
        '## Сontacts form\n\nText with Сyrillic is not a heading.\n\n### Рабочие заметки\n',
      ),
    ).toEqual([
      { text: 'Сontacts form', detail: 'U+0421 Cyrillic at character 1' },
    ]);
  });

  it('reads the text of formatted headings', () => {
    expect(findMixedScriptHeadings('## **Тeam** notes\n')).toEqual([
      { text: 'Тeam notes', detail: 'U+0422 Cyrillic at character 1' },
    ]);
  });
});

describe('the title report', () => {
  it('is a pure function of its input, whatever order it arrives in', () => {
    const first = input({ id: 'a', slug: 'a' });
    const second = input({ id: 'b', slug: 'b' });

    expect(serializeTitleReport(createTitleReport([second, first]))).toBe(
      serializeTitleReport(createTitleReport([first, second])),
    );
  });

  it('summarizes what the documents open with', () => {
    const report = createTitleReport([
      input({
        id: 'a',
        slug: 'a',
        source: facts({ style: 'title', text: 'Pricing', blockIndex: 0 }, [
          'title',
          'text',
        ]),
      }),
      input({
        id: 'b',
        slug: 'b',
        name: 'Team_Guide',
        title: 'Team_Guide',
        source: facts(
          { style: 'heading-1', text: 'General Information', blockIndex: 1 },
          ['text', 'heading-1'],
        ),
        body: '## Сontacts\n',
      }),
      input({ id: 'c', slug: 'c', source: null, removedTitleHeading: null }),
    ]);

    expect(report.summary).toMatchObject({
      documents: 3,
      inspected: 2,
      candidate: { title: 1, 'heading-1': 1, none: 0 },
      candidateOpensDocument: 1,
      match: { identical: 1, different: 1 },
      names: { orderPrefix: 2, underscorePrefix: 1 },
      mixedScriptHeadings: 1,
    });
    expect(report.summary.firstBlock).toMatchObject({ title: 1, text: 1 });
    expect(
      report.documents.find((document) => document.id === 'c'),
    ).toMatchObject({
      match: null,
      similarity: null,
    });
  });

  it('keeps the facts an earlier run recorded', () => {
    const recorded = createTitleReport([
      input({
        source: facts({ style: 'title', text: 'Pricing', blockIndex: 0 }),
        removedTitleHeading: true,
      }),
    ]);

    expect(
      recordedTitleFacts(serializeTitleReport(recorded)).get('doc'),
    ).toEqual({
      source: facts({ style: 'title', text: 'Pricing', blockIndex: 0 }),
      removedTitleHeading: true,
    });
    expect(recordedTitleFacts(undefined).size).toBe(0);
    expect(recordedTitleFacts('not json').size).toBe(0);
  });

  it('prints counts, and names documents only when asked', () => {
    const report = createTitleReport([
      input({
        source: facts({
          style: 'heading-1',
          text: 'General Information',
          blockIndex: 0,
        }),
      }),
    ]);
    const summary = formatTitleReport(report, {
      list: false,
      path: 'data/title-report.json',
    }).join('\n');
    const listing = formatTitleReport(report, {
      list: true,
      path: 'data/title-report.json',
    }).join('\n');

    expect(summary).toContain('Against file name: different 1');
    expect(summary).not.toContain('General Information');
    expect(listing).toContain('heading-1: General Information');
  });
});

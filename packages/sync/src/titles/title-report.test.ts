import { describe, expect, it } from 'vitest';

import { looksLikeSection } from './checks.js';
import { formatTitleReport } from './format-title-report.js';
import { readSourceTitle } from './source-title.js';
import {
  classifyTitleMatch,
  createTitleReport,
  nameFeatures,
  recordedTitleFacts,
  serializeTitleReport,
  similarity,
  type TitleReportInput,
} from './title-report.js';

/** A document as the Docs API describes it: `[style, text, headingId]`. */
function source(...paragraphs: Array<[string, string, string?]>) {
  return readSourceTitle(
    paragraphs.map(([namedStyleType, content, headingId]) => ({
      paragraph: {
        paragraphStyle: { namedStyleType, ...(headingId ? { headingId } : {}) },
        elements: [{ textRun: { content } }],
      },
    })),
  );
}

function input(overrides: Partial<TitleReportInput> = {}): TitleReportInput {
  return {
    id: 'doc',
    slug: 'team/pricing',
    name: '01 - Pricing',
    title: 'Pricing',
    folderPath: ['Team'],
    lastEditedBy: 'Editor One',
    source: source(['TITLE', 'Pricing', 'h.title'], ['NORMAL_TEXT', 'Body.']),
    removedTitleHeading: false,
    ...overrides,
  };
}

function checksOf(overrides: Partial<TitleReportInput>, others = []) {
  return createTitleReport([input(overrides), ...others])
    .documents.find((document) => document.id === (overrides.id ?? 'doc'))
    ?.issues.map((issue) => issue.check);
}

describe('how a document title relates to its file name', () => {
  it.each([
    ['Pricing handbook', 'Pricing handbook', 'identical'],
    ['pricing  HANDBOOK', 'Pricing handbook', 'normalized'],
    ['Team — Operating context', 'Team_Operating Context', 'normalized'],
    [
      'Dental Marketing Product Logic',
      'Product Logic - Dental Marketing',
      'reordered',
    ],
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

  it('takes the better of edit similarity and shared words', () => {
    expect(similarity('Pricing', 'pricing')).toBe(1);
    expect(similarity('abc', 'xyz')).toBe(0);
    expect(similarity('Pricing hand-book', 'Pricing handbook')).toBe(0.94);
    expect(
      similarity(
        'Social Media Posting Requirements',
        'Requirements for the social media posting',
      ),
    ).toBe(0.67);
  });
});

describe('what a file name carries besides a title', () => {
  it('notices numbers, underscores, extensions, copies and spaces', () => {
    expect(nameFeatures('03 - Copy of Team_Stack_Handbook.docx ')).toEqual({
      orderPrefix: true,
      underscorePrefix: false,
      underscores: true,
      fileExtension: true,
      copyOf: true,
      extraSpaces: true,
    });
    expect(nameFeatures('Team_Stack_Handbook.doc')).toMatchObject({
      underscorePrefix: true,
      fileExtension: true,
    });
    expect(nameFeatures('Pricing handbook')).toEqual({
      orderPrefix: false,
      underscorePrefix: false,
      underscores: false,
      fileExtension: false,
      copyOf: false,
      extraSpaces: false,
    });
  });
});

describe('what reads like a section rather than a name', () => {
  it.each([
    '1. Which type to target',
    'Part 2',
    'Stage 1 — Preparation',
    'Часть 1. Рекомендации',
    'Tabs:',
    'General Information',
    'Overview',
    'En Version',
  ])('%s', (text) => {
    expect(looksLikeSection(text)).toBe(true);
  });

  it.each(['Pricing handbook', 'Short guide about what the company is'])(
    'not %s',
    (text) => {
      expect(looksLikeSection(text)).toBe(false);
    },
  );
});

describe('the checks a document fails', () => {
  it('passes a document that opens with one Title line', () => {
    expect(checksOf({})).toEqual([]);
  });

  it('asks to restyle a single opening Heading 1 as the title', () => {
    const report = createTitleReport([
      input({
        source: source(['HEADING_1', 'Pricing', 'h.h1'], ['NORMAL_TEXT', 'x']),
      }),
    ]);
    expect(report.documents[0]?.issues).toEqual([
      {
        check: 'title-styled-as-heading-1',
        text: 'Pricing',
        headingId: 'h.h1',
      },
    ]);
  });

  it('asks for a title when the document opens with a section', () => {
    expect(
      checksOf({
        source: source(['HEADING_1', 'Overview'], ['HEADING_1', 'Details']),
      }),
    ).toEqual(['title-missing']);
    expect(
      checksOf({
        source: source(['HEADING_2', 'Setup'], ['NORMAL_TEXT', 'x']),
      }),
    ).toEqual(['title-missing']);
  });

  it('lists a Title used for a section, and every Title after the first', () => {
    const report = createTitleReport([
      input({
        source: source(
          ['TITLE', 'En Version', 'h.a'],
          ['NORMAL_TEXT', 'x'],
          ['TITLE', 'Short Version', 'h.b'],
        ),
      }),
    ]);
    expect(report.documents[0]?.issues).toEqual([
      { check: 'title-missing' },
      { check: 'title-style-on-section', text: 'En Version', headingId: 'h.a' },
      {
        check: 'title-style-on-section',
        text: 'Short Version',
        headingId: 'h.b',
      },
    ]);
    expect(
      checksOf({
        source: source(['TITLE', 'Pricing'], ['TITLE', 'Appendix']),
      }),
    ).toEqual(['title-style-on-section']);
  });

  it('asks to move a Title that is not the first line', () => {
    expect(
      checksOf({
        source: source(['NORMAL_TEXT', 'Draft'], ['TITLE', 'Pricing']),
      }),
    ).toEqual(['title-not-first']);
  });

  it("recognizes another document's title at the top", () => {
    const report = createTitleReport([
      input({
        id: 'matrix',
        slug: 'team/quality-matrix',
        name: 'Team_Quality Acceptance Matrix',
        title: 'Team_Quality Acceptance Matrix',
        source: source(['HEADING_1', 'Team Business Units RACI', 'h.raci']),
      }),
      input({
        id: 'raci',
        slug: 'team/raci',
        name: 'Team_Business Units RACI',
        title: 'Team_Business Units RACI',
      }),
    ]);
    expect(
      report.documents.find((document) => document.id === 'matrix')?.issues[0],
    ).toEqual({
      check: 'heading-from-another-document',
      text: 'Team Business Units RACI',
      headingId: 'h.raci',
      related: { slug: 'team/raci', title: 'Team_Business Units RACI' },
    });
  });

  it('reports a heading that mixes alphabets, with a link to it', () => {
    const report = createTitleReport([
      input({
        source: source(
          ['TITLE', 'Pricing'],
          ['HEADING_2', 'Сontacts form', 'h.contacts'],
          ['NORMAL_TEXT', 'Сontacts in body text are not checked.'],
        ),
      }),
    ]);
    expect(report.documents[0]?.issues).toEqual([
      {
        check: 'heading-mixes-alphabets',
        text: 'Сontacts form',
        detail: 'U+0421 Cyrillic at character 1',
        headingId: 'h.contacts',
      },
    ]);
  });

  it('reports an empty document and nothing about its title', () => {
    expect(checksOf({ source: source() })).toEqual(['empty-document']);
  });

  it('checks the file name of a document not inspected yet', () => {
    expect(
      checksOf({ source: null, name: 'Copy of Team_Pricing.doc', title: 'x' }),
    ).toEqual([
      'file-name-copy-of',
      'file-name-extension',
      'file-name-underscores',
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

  it('counts documents by check and by severity', () => {
    const report = createTitleReport([
      input({ id: 'a', slug: 'a' }),
      input({
        id: 'b',
        slug: 'b',
        name: 'Copy of Guide',
        source: source(['HEADING_2', 'Сontacts'], ['NORMAL_TEXT', 'x']),
      }),
      input({ id: 'c', slug: 'c', source: null }),
    ]);

    expect(report.summary).toMatchObject({
      documents: 3,
      inspected: 2,
      conforming: 1,
      severity: { fix: 1, convention: 1, note: 1 },
      checks: {
        'heading-mixes-alphabets': 1,
        'title-missing': 1,
        'file-name-copy-of': 1,
      },
    });
    expect(report.checks.map((check) => check.severity)).toEqual([
      'fix',
      'fix',
      'fix',
      'convention',
      'convention',
      'convention',
      'convention',
      'note',
      'note',
      'note',
      'note',
    ]);
  });

  it('keeps the facts an earlier run recorded, byte for byte', () => {
    const recorded = createTitleReport([input({ removedTitleHeading: true })]);
    const carried = recordedTitleFacts(serializeTitleReport(recorded)).get(
      'doc',
    );

    expect(carried).toEqual({
      source: input().source,
      removedTitleHeading: true,
      lastEditedBy: 'Editor One',
    });
    expect(JSON.stringify(carried?.source)).toBe(
      JSON.stringify(input().source),
    );
    expect(recordedTitleFacts(undefined).size).toBe(0);
    expect(recordedTitleFacts('not json').size).toBe(0);
  });

  it('forgets facts recorded in an earlier shape', () => {
    const earlier = JSON.stringify({
      documents: [
        {
          id: 'doc',
          source: { firstBlocks: [], titleCount: 0, heading1Count: 0 },
          removedTitleHeading: false,
        },
      ],
    });
    expect(recordedTitleFacts(earlier).get('doc')).toEqual({
      source: null,
      removedTitleHeading: false,
      lastEditedBy: null,
    });
  });

  it('prints counts, and names documents only when asked', () => {
    const report = createTitleReport([
      input({
        source: source(['HEADING_2', 'Сontacts', 'h.c'], ['NORMAL_TEXT', 'x']),
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

    expect(summary).toContain('Following the proposed convention: 0 of 1');
    expect(summary).not.toContain('Сontacts');
    expect(summary).not.toContain('01 - Pricing');
    expect(listing).toContain('“Сontacts” — U+0421 Cyrillic at character 1');
    expect(listing).toContain('(last edited by Editor One)');
    expect(listing).toContain(
      'https://docs.google.com/document/d/doc/edit#heading=h.c',
    );
  });
});

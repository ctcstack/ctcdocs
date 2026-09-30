import { describe, expect, it } from 'vitest';

import { looksLikeSection } from './checks.js';
import { formatTitleReport } from './format-title-report.js';
import { readSourceTitle } from './source-title.js';
import {
  classifyTitleMatch,
  createTitleReport,
  nameFeatures,
  outdatedTitleFacts,
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

  it('reports a heading that skips a level, as the page shows it', () => {
    const report = createTitleReport([
      input({
        source: source(
          ['TITLE', 'Pricing', 'h.title'],
          // The page shows a Heading 1 beside a Heading 2, so this is no skip.
          ['HEADING_1', 'Rates', 'h.rates'],
          ['HEADING_3', 'Discounts', 'h.discounts'],
          ['HEADING_5', 'Seasonal', 'h.seasonal'],
          ['HEADING_2', 'Terms', 'h.terms'],
          ['HEADING_4', 'Notice', 'h.notice'],
        ),
      }),
    ]);
    expect(report.documents[0]?.issues).toEqual([
      {
        check: 'heading-skips-level',
        text: 'Seasonal',
        detail: 'Heading 5 after Heading 3',
        headingId: 'h.seasonal',
      },
      {
        check: 'heading-skips-level',
        text: 'Notice',
        detail: 'Heading 4 after Heading 2',
        headingId: 'h.notice',
      },
    ]);
  });

  it('judges the heading after the opening line by whether the page kept it', () => {
    const opening = source(
      ['TITLE', 'Pricing', 'h.title'],
      ['NORMAL_TEXT', 'For the sales team.'],
      ['HEADING_3', 'Scope', 'h.scope'],
    );
    const issuesWhen = (removedTitleHeading: boolean) =>
      createTitleReport([input({ source: opening, removedTitleHeading })])
        .documents[0]?.issues;

    // Dropped as a copy of the name, the line leaves the page's title above.
    expect(issuesWhen(true)).toEqual([
      {
        check: 'heading-skips-level',
        text: 'Scope',
        detail: 'Heading 3 under the title',
        headingId: 'h.scope',
      },
    ]);
    // Kept, it is a second-level heading, and a Heading 3 follows it fine.
    expect(issuesWhen(false)).toEqual([]);
  });

  it('reads a Title line used as a section at the second level', () => {
    const report = createTitleReport([
      input({
        source: source(
          ['TITLE', 'Pricing', 'h.title'],
          ['HEADING_3', 'Scope', 'h.scope'],
          ['TITLE', 'Appendix', 'h.appendix'],
          ['HEADING_5', 'Tables', 'h.tables'],
        ),
        removedTitleHeading: true,
      }),
    ]);
    expect(
      report.documents[0]?.issues.filter(
        (issue) => issue.check === 'heading-skips-level',
      ),
    ).toEqual([
      {
        check: 'heading-skips-level',
        text: 'Scope',
        detail: 'Heading 3 under the title',
        headingId: 'h.scope',
      },
      {
        check: 'heading-skips-level',
        text: 'Tables',
        detail: 'Heading 5 after Title',
        headingId: 'h.tables',
      },
    ]);
  });

  it('reads headings in a one-cell frame as part of the page', () => {
    const paragraph = (
      namedStyleType: string,
      content: string,
      id: string,
    ) => ({
      paragraph: {
        paragraphStyle: { namedStyleType, headingId: id },
        elements: [{ textRun: { content } }],
      },
    });
    const facts = readSourceTitle([
      paragraph('HEADING_2', 'Steps', 'h.steps'),
      {
        table: {
          tableRows: [
            {
              tableCells: [
                { content: [paragraph('HEADING_4', 'Steps:', 'h.framed')] },
              ],
            },
          ],
        },
      },
      {
        table: {
          tableRows: [
            {
              tableCells: [
                { content: [paragraph('HEADING_6', 'Cell', 'h.cell')] },
                { content: [] },
              ],
            },
          ],
        },
      },
    ]);

    expect(facts.skippedHeadings).toEqual([
      {
        text: 'Steps:',
        detail: 'Heading 4 after Heading 2',
        headingId: 'h.framed',
      },
    ]);
    // "Steps:" repeats "Steps": punctuation is not a different name.
    expect(facts.repeatedHeadings).toEqual([
      { text: 'Steps:', headingId: 'h.framed' },
    ]);
  });

  it('reports a heading with the words of an earlier one', () => {
    const report = createTitleReport([
      input({
        source: source(
          ['TITLE', 'Pricing', 'h.title'],
          ['HEADING_1', 'Setup', 'h.setup'],
          ['HEADING_2', 'Steps', 'h.steps'],
          ['HEADING_1', 'Upgrade', 'h.upgrade'],
          ['HEADING_2', '  STEPS ', 'h.steps-again'],
        ),
      }),
    ]);
    expect(report.documents[0]?.issues).toEqual([
      {
        check: 'heading-repeated',
        text: 'STEPS',
        headingId: 'h.steps-again',
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
      sourceVersion: 4,
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
      sourceVersion: null,
      removedTitleHeading: false,
      lastEditedBy: null,
    });
  });

  it('names the documents whose facts an earlier shape recorded', () => {
    const current = serializeTitleReport(createTitleReport([input()]));
    const earlier = JSON.stringify({
      documents: [
        { id: 'old', source: { version: 3, firstBlocks: [] } },
        { id: 'never-inspected', source: null },
        { id: 'unversioned', source: { firstBlocks: [] } },
      ],
    });
    const outdated = (content: string | undefined) =>
      outdatedTitleFacts(recordedTitleFacts(content));

    expect([...outdated(earlier)]).toEqual(['old']);
    expect(outdated(current).size).toBe(0);
    expect(outdated(undefined).size).toBe(0);
    expect(outdated('not json').size).toBe(0);
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

  it('links to the tab a heading is in', () => {
    const report = createTitleReport([
      input({
        source: readSourceTitle(
          [],
          [
            {
              tabId: 't.second',
              content: [
                {
                  paragraph: {
                    paragraphStyle: {
                      namedStyleType: 'HEADING_2',
                      headingId: 'h.next',
                    },
                    elements: [{ textRun: { content: 'Nеxt steps' } }],
                  },
                },
              ],
            },
          ],
        ),
      }),
    ]);

    expect(
      formatTitleReport(report, { list: true, path: 'report.json' }).join('\n'),
    ).toContain(
      'https://docs.google.com/document/d/doc/edit?tab=t.second#heading=h.next',
    );
  });
});

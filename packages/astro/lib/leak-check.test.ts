import { describe, expect, it } from 'vitest';

import {
  findLeaks,
  htmlSegments,
  RUN_LENGTH,
  textSegments,
  words,
} from './leak-check.js';

const secret =
  'the quarterly payroll adjustment applies to every contractor in the northern region';
const readers: Record<string, readonly string[] | '*'> = {
  members: '*',
  finance: ['finance@example.com', 'leads@example.com'],
  leads: ['leads@example.com'],
  hr: ['hr@example.com'],
  admins: [],
};

function check(files: { path: string; cls: string; text: string }[]) {
  return findLeaks({
    documents: [
      { path: '/finance/payroll/', cls: 'finance', segments: [secret] },
      {
        path: '/handbook/welcome/',
        cls: 'members',
        segments: [
          'every new joiner reads the handbook in their first week here',
        ],
      },
    ],
    files: files.map(({ path, cls, text }) => ({
      path,
      cls,
      segments: [text],
    })),
    allowed: [
      'How the quarterly payroll adjustment applies to every contractor anywhere',
    ],
    readers: (cls) => readers[cls],
  });
}

describe('findLeaks', () => {
  it('finds eight words of a restricted document in a members file', () => {
    const run = secret
      .split(' ')
      .slice(3, 3 + RUN_LENGTH)
      .join(' ');
    expect(
      check([{ path: '/llms.txt', cls: 'members', text: `- x: ${run}` }]),
    ).toEqual([
      {
        file: '/llms.txt',
        fileClass: 'members',
        document: '/finance/payroll/',
        documentClass: 'finance',
        offset: 1,
      },
    ]);
  });

  it('lets seven words through', () => {
    const run = secret
      .split(' ')
      .slice(3, 3 + RUN_LENGTH - 1)
      .join(' ');
    expect(check([{ path: '/', cls: 'members', text: run }])).toEqual([]);
  });

  it('allows text every member may read, and titles', () => {
    expect(
      check([
        {
          path: '/',
          cls: 'members',
          text: 'every new joiner reads the handbook in their first week here',
        },
        {
          path: '/documents/',
          cls: 'platform',
          text: 'the quarterly payroll adjustment applies to every contractor',
        },
      ]),
    ).toEqual([]);
  });

  it('allows the same class, a narrower class and the admins', () => {
    expect(
      check([
        { path: '/finance/', cls: 'finance', text: secret },
        { path: '/finance/leads/', cls: 'leads', text: secret },
        { path: '/content-health/', cls: 'admins', text: secret },
      ]),
    ).toEqual([]);
  });

  it('refuses a class that is not within the document’s readers', () => {
    expect(check([{ path: '/hr/llms.txt', cls: 'hr', text: secret }])).toEqual([
      expect.objectContaining({ file: '/hr/llms.txt', fileClass: 'hr' }),
    ]);
  });
});

describe('segments', () => {
  it('breaks HTML at blocks and reads attributes and JSON-LD on their own', () => {
    const segments = htmlSegments(
      `<html><head><title>Plan</title>
        <meta name="description" content="A description of the plan.">
        <script type="application/ld+json">{"description":"Linked data."}</script>
        <script>var ignored = 'never read';</script>
      </head><body>
        <nav><a>First title</a><a>Second title</a></nav>
        <p>One <strong>inline</strong> paragraph.</p>
        <img alt="An image description">
      </body></html>`,
    );
    expect(segments).toEqual([
      'Plan',
      'A description of the plan.',
      '{"description":"Linked data."}',
      'First titleSecond title',
      'One inline paragraph.',
      'An image description',
    ]);
  });

  it('reads only the part a selector names', () => {
    expect(
      htmlSegments(
        '<nav>Menu</nav><main data-pagefind-body><p>Body</p></main>',
        '[data-pagefind-body]',
      ),
    ).toEqual(['Body']);
  });

  it('splits text by line, and Markdown by paragraph', () => {
    expect(textSegments('a\nb\n\nc', false)).toEqual(['a', 'b', 'c']);
    expect(textSegments('a\nb\n\nc', true)).toEqual(['a\nb', 'c']);
  });

  it('reads words as search does', () => {
    expect(words('Ｃafé — Отчёт_2026, v2.1')).toEqual([
      'café',
      'отчёт',
      '2026',
      'v2',
      '1',
    ]);
  });
});

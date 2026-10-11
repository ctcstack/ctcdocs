import { describe, expect, it } from 'vitest';

import { INSIGHTS_ROUTE as WORKER_ROUTE } from '../worker/access-map';
import { INSIGHTS_ROUTE, parseInsights, readInsights } from './insights-report';

const answering = (status: number, body: unknown) =>
  (async () =>
    new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

const answer = {
  report: {
    week: '2026-10-05',
    records: { mcpCalls: 50_000, truncated: true, unreadable: 3 },
    notFound: [
      {
        label: 'parking permit',
        count: 3,
        site: 1,
        queries: [
          { query: 'parking permit', count: 2 },
          { query: 'Parking permits?', count: 1 },
          { query: '', count: 1 },
        ],
        clients: [
          { client: 'Claude', count: 2 },
          { client: null, count: 1 },
        ],
        documents: [
          { id: 'aaaaaa', count: 2 },
          { id: 'bbbbbb', count: 1 },
          { id: 'cccccc', count: 1 },
          { id: 'javascript:alert(1)', count: 1 },
        ],
      },
      { label: '', count: 1 },
      { label: 'no count' },
    ],
    foundNotRead: [
      { id: 'aaaaaa', appearances: 12, fetches: 0 },
      { id: 'dddddd', appearances: 'many', fetches: 0 },
    ],
    use: {
      notFound: {
        mcp: { searches: 40, notFound: 6, share: 0.15 },
        site: { searches: 10, notFound: 1, share: 0.1 },
      },
    },
  },
  documents: {
    aaaaaa: { title: 'Parking', url: '/d/aaaaaa/' },
    // A link anywhere but a permanent link is not kept.
    bbbbbb: { title: 'Elsewhere', url: 'https://example.org/' },
  },
};

describe('the insights report in the browser', () => {
  it('asks the route the Worker answers', () => {
    expect(INSIGHTS_ROUTE).toBe(WORKER_ROUTE);
  });

  it('keeps what it can show, and only links that stay on the site', () => {
    expect(parseInsights(answer)).toEqual({
      kind: 'report',
      view: {
        week: '2026-10-05',
        searches: 40,
        notFound: 6,
        siteSearches: 10,
        siteNotFound: 1,
        truncated: true,
        unreadable: 3,
        groups: [
          {
            label: 'parking permit',
            count: 3,
            site: 1,
            variants: ['Parking permits?'],
            clients: ['Claude'],
            documents: [
              { id: 'aaaaaa', title: 'Parking', url: '/d/aaaaaa/' },
              { id: 'bbbbbb' },
              { id: 'cccccc' },
            ],
          },
        ],
        unread: [
          {
            id: 'aaaaaa',
            title: 'Parking',
            url: '/d/aaaaaa/',
            appearances: 12,
            fetches: 0,
          },
        ],
      },
    });
  });

  it('says when no report is kept yet, and gives nothing for anything else', async () => {
    expect(parseInsights({ report: null, documents: {} })).toEqual({
      kind: 'none',
    });
    for (const body of [null, [], { report: {} }, { report: { week: 7 } }]) {
      expect(parseInsights(body)).toBeUndefined();
    }
    expect(await readInsights(answering(200, answer))).toMatchObject({
      kind: 'report',
    });
    for (const status of [401, 403, 404, 503]) {
      expect(await readInsights(answering(status, answer))).toBeUndefined();
    }
    const offline = (async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch;
    expect(await readInsights(offline)).toBeUndefined();
  });
});

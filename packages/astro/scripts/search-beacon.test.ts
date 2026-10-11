import { describe, expect, it } from 'vitest';

import { INSIGHTS_SEARCH_ROUTE } from '../worker/access-map';
import {
  SEARCH_REPORT_ROUTE,
  SearchReporter,
  SETTLE_MS,
  type SearchReport,
} from './search-beacon';

/** A reporter on a clock the test moves. */
function reporter(results = () => 3) {
  const sent: SearchReport[] = [];
  let now = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  let next = 0;
  const search = new SearchReporter({
    send: (report) => sent.push(report),
    results,
    setTimer: (callback, ms) => {
      next += 1;
      timers.set(next, { at: now + ms, callback });
      return next;
    },
    clearTimer: (timer) => timers.delete(timer as number),
  });
  const wait = (ms: number) => {
    now += ms;
    for (const [id, timer] of [...timers]) {
      if (timer.at <= now) {
        timers.delete(id);
        timer.callback();
      }
    }
  };
  return { search, sent, wait };
}

describe('SearchReporter', () => {
  it('reports to the route the Worker takes', () => {
    expect(SEARCH_REPORT_ROUTE).toBe(INSIGHTS_SEARCH_ROUTE);
  });

  it('settles a search after a pause, and sends it when what follows is known', () => {
    const { search, sent, wait } = reporter();
    search.typed('p');
    search.typed('pa');
    search.typed('parking');
    wait(SETTLE_MS - 1);
    search.flush();
    // Not yet settled: still typing.
    expect(sent).toEqual([]);
    search.typed('parking');
    wait(SETTLE_MS);
    expect(sent).toEqual([]);
    search.flush();
    expect(sent).toEqual([{ query: 'parking', results: 3 }]);
  });

  it('sends a settled search once, with the result opened from it', () => {
    const { search, sent, wait } = reporter();
    search.typed('parking');
    wait(SETTLE_MS);
    search.opened('/handbook/');
    search.flush();
    expect(sent).toEqual([
      { query: 'parking', results: 3, opened: '/handbook/' },
    ]);
  });

  it('settles a search at once when a result is opened', () => {
    const { search, sent } = reporter();
    search.typed('vacation');
    search.opened('/handbook/');
    expect(sent).toEqual([
      { query: 'vacation', results: 3, opened: '/handbook/' },
    ]);
  });

  it('sends the settled search when another begins', () => {
    const { search, sent, wait } = reporter();
    search.typed('parking');
    wait(SETTLE_MS);
    search.typed('parking ');
    // The same words, still: one search, not sent yet.
    expect(sent).toEqual([]);
    search.typed('parking permit');
    expect(sent).toEqual([{ query: 'parking', results: 3 }]);
  });

  it('reports no blank search, and nothing twice', () => {
    const { search, sent, wait } = reporter();
    search.typed('   ');
    wait(SETTLE_MS);
    search.flush();
    search.typed('x');
    wait(SETTLE_MS);
    search.flush();
    search.flush();
    expect(sent).toEqual([{ query: 'x', results: 3 }]);
  });

  it('counts the results as they are when the search settles', () => {
    let shown = 0;
    const { search, sent, wait } = reporter(() => shown);
    search.typed('handbook');
    shown = 5;
    wait(SETTLE_MS);
    shown = 0;
    search.flush();
    expect(sent).toEqual([{ query: 'handbook', results: 5 }]);
  });
});

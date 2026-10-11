import { describe, expect, it } from 'vitest';

import { INSIGHTS_SEARCH_ROUTE } from '../worker/access-map';
import {
  SEARCH_REPORT_ROUTE,
  SearchReporter,
  SETTLE_MS,
  type SearchReport,
} from './search-beacon';

/** A reporter on a clock the test moves, over a box the test fills. */
function reporter(results: () => number | undefined = () => 3) {
  const sent: SearchReport[] = [];
  let now = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  let next = 0;
  const box = { value: '' };
  const search = new SearchReporter({
    send: (report) => sent.push(report),
    query: () => box.value,
    results,
    setTimer: (callback, ms) => {
      next += 1;
      timers.set(next, { at: now + ms, callback });
      return next;
    },
    clearTimer: (timer) => timers.delete(timer as number),
  });
  const wait = (ms: number) => {
    const until = now + ms;
    // Step through the timers due, as a clock would, including those they set.
    for (;;) {
      const due = [...timers].sort(([, a], [, b]) => a.at - b.at)[0];
      if (!due || due[1].at > until) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].callback();
    }
    now = until;
  };
  // As the page does: the box holds the text, then the reporter hears it.
  const type = (text: string) => {
    box.value = text;
    search.typed(text);
  };
  return { search, sent, wait, type, box };
}

describe('SearchReporter', () => {
  it('reports nothing of a search cleared without a keystroke', () => {
    const { sent, wait, type, box, search } = reporter();
    type('pricing');
    wait(1_000);
    // Escape, or Pagefind's clear button: the box empties, no event says so.
    box.value = '';
    wait(SETTLE_MS);
    search.flush();
    expect(sent).toEqual([]);
  });

  it('drops a search closed before it settled, and sends one settled', () => {
    const { sent, wait, type, search } = reporter();
    type('pricing');
    wait(1_000);
    search.abandon();
    wait(SETTLE_MS);
    search.flush();
    expect(sent).toEqual([]);

    type('parking');
    wait(SETTLE_MS);
    search.abandon();
    expect(sent).toEqual([{ query: 'parking', results: 3 }]);
  });

  it('waits for results still loading, and gives up on ones that never come', () => {
    let shown: number | undefined;
    const { sent, wait, type, search } = reporter(() => shown);
    type('handbook');
    wait(SETTLE_MS + 1_000);
    shown = 0;
    wait(500);
    search.flush();
    expect(sent).toEqual([{ query: 'handbook', results: 0 }]);

    shown = undefined;
    type('never');
    wait(SETTLE_MS + 11_000);
    shown = 4;
    wait(5_000);
    search.flush();
    expect(sent).toHaveLength(1);
  });

  it('counts a result opened while the rest load as one shown', () => {
    const { sent, type, search } = reporter(() => undefined);
    type('vacation');
    search.opened('/handbook/');
    expect(sent).toEqual([
      { query: 'vacation', results: 1, opened: '/handbook/' },
    ]);
  });

  it('reports to the route the Worker takes', () => {
    expect(SEARCH_REPORT_ROUTE).toBe(INSIGHTS_SEARCH_ROUTE);
  });

  it('settles a search after a pause, and sends it when what follows is known', () => {
    const { search, sent, wait, type } = reporter();
    type('p');
    type('pa');
    type('parking');
    wait(SETTLE_MS - 1);
    search.flush();
    // Not yet settled: still typing.
    expect(sent).toEqual([]);
    type('parking');
    wait(SETTLE_MS);
    expect(sent).toEqual([]);
    search.flush();
    expect(sent).toEqual([{ query: 'parking', results: 3 }]);
  });

  it('sends a settled search once, with the result opened from it', () => {
    const { search, sent, wait, type } = reporter();
    type('parking');
    wait(SETTLE_MS);
    search.opened('/handbook/');
    search.flush();
    expect(sent).toEqual([
      { query: 'parking', results: 3, opened: '/handbook/' },
    ]);
  });

  it('settles a search at once when a result is opened', () => {
    const { search, sent, type } = reporter();
    type('vacation');
    search.opened('/handbook/');
    expect(sent).toEqual([
      { query: 'vacation', results: 3, opened: '/handbook/' },
    ]);
  });

  it('sends the settled search when another begins', () => {
    const { sent, wait, type } = reporter();
    type('parking');
    wait(SETTLE_MS);
    type('parking ');
    // The same words, still: one search, not sent yet.
    expect(sent).toEqual([]);
    type('parking permit');
    expect(sent).toEqual([{ query: 'parking', results: 3 }]);
  });

  it('reports no blank search, and nothing twice', () => {
    const { search, sent, wait, type } = reporter();
    type('   ');
    wait(SETTLE_MS);
    search.flush();
    type('x');
    wait(SETTLE_MS);
    search.flush();
    search.flush();
    expect(sent).toEqual([{ query: 'x', results: 3 }]);
  });

  it('counts the results as they are when the search settles', () => {
    let shown = 0;
    const { search, sent, wait, type } = reporter(() => shown);
    type('handbook');
    shown = 5;
    wait(SETTLE_MS);
    shown = 0;
    search.flush();
    expect(sent).toEqual([{ query: 'handbook', results: 5 }]);
  });
});

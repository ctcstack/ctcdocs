/**
 * Settled site searches, as the page reports them to the Worker (ADR-051).
 *
 * A search is settled 1.5 seconds after the last keystroke, or when a result
 * is opened. A settled search is sent once, when what follows it is known:
 * the next search, a result opened, the search closed or the page left. So
 * a search followed by a result opened is one report, with the page.
 *
 * Browser code: it must not import the platform's core. The route is
 * restated here and a test keeps it equal to the Worker's. Nothing here
 * names the reader: the Worker reads who asks from the session.
 */

/** Where the Worker takes a settled search. */
export const SEARCH_REPORT_ROUTE = '/_kb/insights/search';

/** Milliseconds without typing after which a search is settled. */
export const SETTLE_MS = 1_500;

export interface SearchReport {
  readonly query: string;
  readonly results: number;
  readonly opened?: string;
}

export interface SearchReporterOptions {
  /** Sends one report; with `sendBeacon`, it outlives the page. */
  readonly send: (report: SearchReport) => void;
  /** How many results the search shows now. */
  readonly results: () => number;
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  readonly clearTimer?: (timer: unknown) => void;
}

export class SearchReporter {
  private timer: unknown;
  private typing: string | undefined;
  private settled: SearchReport | undefined;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;

  constructor(private readonly options: SearchReporterOptions) {
    this.setTimer =
      options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer =
      options.clearTimer ??
      ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  }

  /** The search box holds `query` now. */
  typed(query: string): void {
    const text = query.trim();
    this.stopTimer();
    if (this.settled && this.settled.query !== text) {
      this.flush();
    }
    this.typing = text.length > 0 ? text : undefined;
    if (this.typing) {
      this.timer = this.setTimer(() => this.settle(), SETTLE_MS);
    }
  }

  /** A result was opened: the search is settled, and sent with the page. */
  opened(path: string): void {
    this.settle();
    if (this.settled) {
      this.settled = { ...this.settled, opened: path };
    }
    this.flush();
  }

  /** The search was closed, or the page is left: what is settled goes. */
  flush(): void {
    const report = this.settled;
    this.settled = undefined;
    if (report) {
      this.options.send(report);
    }
  }

  private settle(): void {
    this.stopTimer();
    if (this.typing) {
      this.settled = { query: this.typing, results: this.options.results() };
      this.typing = undefined;
    }
  }

  private stopTimer(): void {
    if (this.timer !== undefined) {
      this.clearTimer(this.timer);
      this.timer = undefined;
    }
  }
}

/** Sends a report as the page goes, as `navigator.sendBeacon` does. */
export function beacon(report: SearchReport): void {
  try {
    navigator.sendBeacon(
      SEARCH_REPORT_ROUTE,
      new Blob([JSON.stringify(report)], { type: 'application/json' }),
    );
  } catch {
    // A report that cannot be sent is not sent; the search is unaffected.
  }
}

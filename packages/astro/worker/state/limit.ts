/**
 * How many records of use one person may write (ADR-051): at most 60 MCP
 * calls and 30 site searches a minute in each isolate. An assistant in a loop is answered as ever;
 * only its records past the line are dropped, so it cannot fill the
 * database, or its bill, with copies of one call.
 *
 * The count is kept in memory by the key the caller gives, and never leaves
 * it: no record, log or response names the key.
 */

/** Records one key may write a minute, by default: MCP calls. */
export const RECORDS_PER_MINUTE = 60;
/** Site searches one session may record a minute. */
export const SITE_SEARCHES_PER_MINUTE = 30;
const MINUTE_MS = 60_000;
/** Keys kept at most; past it, the windows that have ended are let go. */
const KEYS = 10_000;

export class RecordLimit {
  private readonly windows = new Map<
    string,
    { start: number; count: number }
  >();

  constructor(private readonly perMinute = RECORDS_PER_MINUTE) {}

  /**
   * Counts one record for `key` at `now`: whether it may be written, and how
   * many this minute were not, so that a caller logs the first it drops.
   */
  take(key: string, now: number): { record: boolean; dropped: number } {
    let window = this.windows.get(key);
    if (!window || now - window.start >= MINUTE_MS) {
      this.forgetEnded(now);
      window = { start: now, count: 0 };
      // Set anew, so the map holds keys in the order their windows began.
      this.windows.delete(key);
      this.windows.set(key, window);
    }
    window.count += 1;
    return window.count <= this.perMinute
      ? { record: true, dropped: 0 }
      : { record: false, dropped: window.count - this.perMinute };
  }

  private forgetEnded(now: number): void {
    if (this.windows.size < KEYS) {
      return;
    }
    for (const [key, window] of this.windows) {
      if (now - window.start >= MINUTE_MS) {
        this.windows.delete(key);
      }
    }
    // Every window still open: the oldest go, so memory stays bounded.
    for (const key of this.windows.keys()) {
      if (this.windows.size < KEYS) {
        break;
      }
      this.windows.delete(key);
    }
  }
}

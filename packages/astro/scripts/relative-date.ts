/**
 * Turns an absolute source-edit date into the age a reader actually wants.
 *
 * "Is this instruction still current?" is answered by "3 days ago", not by
 * "Jul 30, 2026". The absolute date is what the server renders, so the built
 * bytes never depend on the clock — identical input produces identical output,
 * which the sync pipeline's determinism rules require. The relative phrasing
 * and the freshness step are applied in the browser, where "ago" is measured
 * against the reader's own present rather than the last build.
 *
 * Without JavaScript the absolute date remains, which is why it is the markup.
 */

const DAY_MS = 86_400_000;

/** Ages that earn ink instead of the muted tone. */
const FRESH_DAYS = 14;
const RECENT_DAYS = 90;

function phrase(days: number): string {
  if (days < 0) return 'just now';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;

  const months = Math.round(days / 30.44);
  if (months < 12) return months === 1 ? 'last month' : `${months} months ago`;

  const years = Math.round(days / 365.25);
  return years === 1 ? 'last year' : `${years} years ago`;
}

class RelativeDate extends HTMLElement {
  connectedCallback() {
    const time = this.querySelector('time');
    const iso = time?.getAttribute('datetime');
    if (!time || !iso) return;

    const then = new Date(iso);
    if (Number.isNaN(then.getTime())) return;

    const absolute = time.textContent?.trim() ?? '';
    const days = Math.floor((Date.now() - then.getTime()) / DAY_MS);

    // The exact date stays reachable rather than being replaced outright.
    if (absolute && !time.title) time.title = absolute;
    time.textContent = phrase(days);

    this.dataset.age =
      days <= FRESH_DAYS ? 'fresh' : days <= RECENT_DAYS ? 'recent' : 'older';
  }
}

customElements.define('relative-date', RelativeDate);

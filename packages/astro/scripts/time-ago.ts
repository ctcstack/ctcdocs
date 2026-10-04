/**
 * How long ago a time was, in words, for the admin pages' scripts: the
 * content health page's sync and the access review's directory read.
 *
 * Browser code, measured against the reader's own clock, so the built bytes
 * never depend on when the site was built.
 */

/** `3 hours ago`, or nothing for a time in the future or unreadable. */
export function timeAgo(time: string, now = Date.now()): string {
  const minutes = Math.round((now - Date.parse(time)) / 60_000);
  if (!(minutes >= 0)) return '';
  const format = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (minutes < 60) return format.format(-minutes, 'minute');
  if (minutes < 48 * 60)
    return format.format(-Math.round(minutes / 60), 'hour');
  return format.format(-Math.round(minutes / 1440), 'day');
}

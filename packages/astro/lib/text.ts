/**
 * Text as one line: every run of whitespace, newlines included, becomes one
 * space, the ends are trimmed, and nothing left is `undefined` rather than an
 * empty string, so a caller can leave the field out.
 */
export function oneLine(value: string | undefined): string | undefined {
  const text = value?.replace(/\s+/gu, ' ').trim();
  return text ? text : undefined;
}

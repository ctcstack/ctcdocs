/**
 * The name an assistant gave when it connected, as the record of its calls
 * labels it (ADR-051).
 */

const CLIENT_CHARACTERS = 64;

/**
 * A plain label of a client's name: letters, digits, spaces and `.-_` only,
 * at most 64 characters; none when nothing is left. The name is the
 * client's own claim, so it labels a report and decides nothing.
 */
export function clientLabel(name: string | undefined): string | undefined {
  const label = Array.from((name ?? '').replace(/\s/gu, ' '))
    .filter((character) => /^[A-Za-z0-9 ._-]$/u.test(character))
    .join('')
    .replace(/ +/gu, ' ')
    .trim()
    .slice(0, CLIENT_CHARACTERS)
    .trim();
  return label.length > 0 ? label : undefined;
}

/**
 * The letters the header's account button shows for a signed-in address:
 * the first letter of the first two parts of its local part, so
 * `jane.doe@` reads JD, or the first two letters of a local part that has
 * one part, so `admin@` reads AD. Digits and symbols are skipped. An address
 * with no letters to show gives an empty string, and the button keeps its
 * person icon.
 */
export function initialsOf(email: string): string {
  const local = email.split('@')[0] ?? '';
  const parts = local.split(/[^\p{L}]+/u).filter((part) => part.length > 0);
  const [first, second] = parts;
  if (first === undefined) {
    return '';
  }
  const letters =
    second === undefined
      ? [...first].slice(0, 2).join('')
      : `${[...first][0]}${[...second][0]}`;
  return letters.toLocaleUpperCase();
}

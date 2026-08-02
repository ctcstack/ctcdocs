/**
 * The Drive naming convention that carries editorial order into the wiki.
 *
 * An editor orders a folder or a document by numbering its name in Drive, and
 * the number is stripped everywhere the name is shown or turned into a URL.
 *
 * The grammar is deliberately narrow. A bare space cannot tell an editor
 * numbering a section apart from an author writing a year, and guessing wrong
 * does not merely mislabel a link — it rewrites the slug, which is a stable
 * identifier. See docs/ADR/013-editorial-navigation-order.md.
 */
/** One to three digits, bracketed or followed by a deliberate separator. */
const ORDER_PREFIX = /^(?:\[(\d{1,3})\]|(\d{1,3})\s*[-–—.])\s*/u;
/** Digits and a space: the shape of an attempt the grammar does not accept. */
const SPACED_DIGITS = /^\d{1,3}(?:\s|$)/u;
export function parseOrderedLabel(value) {
    const normalized = value.normalize('NFC').trim();
    const match = ORDER_PREFIX.exec(normalized);
    if (!match) {
        return {
            order: null,
            label: normalized || 'Untitled',
        };
    }
    const label = normalized.slice(match[0].length).trim();
    return {
        order: Number.parseInt(match[1] ?? match[2] ?? '0', 10),
        label: label || 'Untitled',
    };
}
/**
 * True when a name opens the way a numbered name does but is not one, which is
 * what an editor separating the number with nothing but a space produces. A
 * longer run of digits is a year or a quantity, not an attempt at ordering.
 */
export function hasUnrecognizedOrderPrefix(value) {
    const normalized = value.normalize('NFC').trim();
    return SPACED_DIGITS.test(normalized) && !ORDER_PREFIX.test(normalized);
}

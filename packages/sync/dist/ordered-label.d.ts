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
export interface OrderedLabel {
    /** The number the editor gave the item, or null when it carries none. */
    order: number | null;
    /** The name as a reader should see it, with any order prefix removed. */
    label: string;
}
export declare function parseOrderedLabel(value: string): OrderedLabel;
/**
 * True when a name opens the way a numbered name does but is not one, which is
 * what an editor separating the number with nothing but a space produces. A
 * longer run of digits is a year or a quantity, not an attempt at ordering.
 */
export declare function hasUnrecognizedOrderPrefix(value: string): boolean;

/**
 * The order siblings take in the generated navigation.
 *
 * One function decides it, and the generated sidebar is the only thing that
 * consumes it: order is navigation, not content, so it reaches no document
 * frontmatter, no slug, and no content hash. Starlight's previous and next
 * links follow the sidebar, so they follow this too.
 *
 * See docs/ADR/013-editorial-navigation-order.md.
 */
import type { InventoryIssue, InventorySelection } from './inventory/inventory-graph.js';
export interface NavigationSibling {
    /** Google Drive identifier, which is the final tie-break. */
    id: string;
    /** The Drive name, order prefix included. */
    name: string;
    /** Only a document can be the page a folder opens with. */
    kind: 'folder' | 'document';
}
/**
 * A total order, so a set of siblings sorts the same however Drive happened to
 * list it. The label collation locale is pinned for the same reason: an
 * unqualified comparison follows the build machine's locale, and these names
 * are multilingual.
 */
export declare function compareNavigationSiblings(left: NavigationSibling, right: NavigationSibling, landingTitles: readonly string[]): number;
/**
 * Reports the arrangements that leave the order undefined rather than merely
 * unusual. A folder mixing numbered and unnumbered siblings is not one of
 * them: the tiers define that case, and warning on a supported arrangement
 * would teach operators to ignore the channel.
 */
export declare function findNavigationOrderIssues(selection: InventorySelection, landingTitles: readonly string[]): InventoryIssue[];

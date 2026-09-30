/**
 * Interface text that a check outside the component has to find.
 *
 * The search verifier proves that chrome stays out of the Pagefind index by
 * searching for a label the interface renders inside `data-pagefind-ignore`.
 * It once searched for a sentence no component rendered any more, and passed
 * without testing anything. Reading the label from here, as the component does,
 * means a rename moves both.
 *
 * This module is compiled into `dist-node` because the verifier is a Node
 * program rather than part of a site build.
 */

/**
 * The link in a document's metadata row to its Markdown projection. Every
 * synchronized document renders it, inside the row excluded from the index.
 */
export const VIEW_AS_MARKDOWN_LABEL = 'View as Markdown';

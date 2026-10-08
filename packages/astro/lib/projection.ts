/**
 * Which pages have a Markdown version (ADR-010).
 *
 * The one definition of the pages that have one, shared by the route that
 * serves it, the page that links it, the head that advertises it and the
 * `llms.txt` indexes that list it. Where it is served is
 * `markdownProjectionPath` in the core. It has no dependencies, so a
 * component can import it without pulling in the Markdown pipeline.
 */

/**
 * A synchronized Google document, published PDF or published spreadsheet has
 * a Markdown version.
 */
export function hasMarkdownProjection(sourceType: string | undefined): boolean {
  return (
    sourceType === 'google-doc' ||
    sourceType === 'drive-pdf' ||
    sourceType === 'drive-sheet'
  );
}

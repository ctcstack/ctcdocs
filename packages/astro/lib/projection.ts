/**
 * Which pages have a Markdown version, and where it is served (ADR-010).
 *
 * The one definition of the projection's address and of the pages that have
 * one, shared by the route that serves it, the page that links it, the head
 * that advertises it and the `llms.txt` indexes that list it. It has no
 * dependencies, so a component can import it without pulling in the Markdown
 * pipeline.
 */

/** A synchronized Google document or published PDF has a Markdown version. */
export function hasMarkdownProjection(sourceType: string | undefined): boolean {
  return sourceType === 'google-doc' || sourceType === 'drive-pdf';
}

/** The site path of a page's Markdown version, from its route ID. */
export function markdownProjectionPath(slug: string): string {
  return `/${slug}/index.md`;
}

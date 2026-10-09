/**
 * Which pages have a Markdown version (ADR-010).
 *
 * The one definition of the pages that have one, shared by the route that
 * serves it, the page that links it, the head that advertises it and the
 * `llms.txt` indexes that list it. Where it is served is
 * `markdownProjectionPath` in the core. Its one import has no dependencies,
 * so a component can import it without pulling in the Markdown pipeline.
 */
import { isDocumentSourceType } from '@ctcstack/ctcdocs-core/document-format';

/**
 * A page published from a Drive file — a Google Doc, a PDF, a spreadsheet or
 * a recording — has a Markdown version.
 */
export function hasMarkdownProjection(sourceType: string | undefined): boolean {
  return isDocumentSourceType(sourceType);
}

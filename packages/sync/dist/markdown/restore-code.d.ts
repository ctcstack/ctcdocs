import type { Root } from 'mdast';
/** A fence was opened in the document and never closed. */
export declare const UNTERMINATED_CODE_FENCE = "unterminated_code_fence";
export interface RestoredCode {
    markdown: string;
    warnings: string[];
}
/**
 * Rebuilds fenced code blocks that reached the export as escaped prose. The
 * source is returned unchanged when the document contains no reconstructable
 * fence, so documents without code produce byte-identical output.
 */
export declare function restoreCodeFences(source: string): RestoredCode;
/**
 * Rebuilds inline code spans from the backticks the export escaped. Code
 * blocks are leaves, so a span inside one is never reached.
 */
export declare function restoreInlineCode(tree: Root): void;

type MarkdownIssueCode = 'unsafe_url' | 'unsupported_html' | 'unsupported_image';
export interface MarkdownIssue {
    code: MarkdownIssueCode;
}
export declare class MarkdownNormalizationError extends Error {
    readonly issues: MarkdownIssue[];
    readonly name = "MarkdownNormalizationError";
    constructor(issues: MarkdownIssue[]);
}
export interface NormalizedMarkdown {
    body: string;
    description?: string;
    warnings: string[];
}
export interface MarkdownNormalizationOptions {
    allowHtml?: boolean;
    allowImages?: boolean;
}
export declare function normalizeMarkdown(input: Uint8Array | string, title: string, options?: MarkdownNormalizationOptions): NormalizedMarkdown;
export {};

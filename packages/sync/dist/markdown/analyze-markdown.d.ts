export type MarkdownFallbackReason = 'html' | 'image' | 'table';
export declare function detectMarkdownFallbackReasons(input: Uint8Array | string): MarkdownFallbackReason[];
export declare function collectMarkdownImageUrls(input: string): string[];
export declare function collectMarkdownLinkUrls(input: string): string[];

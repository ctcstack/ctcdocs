export interface InternalLinkRewrite {
    body: string;
    warnings: string[];
}
export declare function rewriteInternalGoogleLinks(body: string, stableSlugs: ReadonlyMap<string, string>): InternalLinkRewrite;

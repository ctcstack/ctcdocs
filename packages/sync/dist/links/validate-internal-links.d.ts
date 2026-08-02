export interface LinkValidationDocument {
    body: string;
    stableSlug: string;
}
export interface BrokenInternalLink {
    sourceSlug: string;
    targetPath: string;
}
export declare function findBrokenInternalLinks(documents: readonly LinkValidationDocument[], redirectSlugs?: ReadonlySet<string>, staticSlugs?: ReadonlySet<string>): BrokenInternalLink[];

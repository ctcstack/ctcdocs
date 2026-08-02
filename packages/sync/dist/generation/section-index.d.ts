export interface SectionIndexEntry {
    /** The name a reader sees, with any order prefix already removed. */
    label: string;
    /** Stable slug of the subfolder or document this entry points at. */
    slug: string;
    description?: string;
}
export interface SectionIndexInput {
    title: string;
    slug: string;
    /** Display labels of the folders above this one. */
    folderPath: string[];
    entries: readonly SectionIndexEntry[];
}
export declare function sectionIndexPath(googleFolderId: string): string;
export declare function generateSectionIndexDocument(input: SectionIndexInput, markdownHeader: string): string;

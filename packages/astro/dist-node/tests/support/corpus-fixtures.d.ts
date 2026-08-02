export interface CorpusFixture {
    /** Google file identifier, which is also the generated asset directory. */
    id: string;
    slug: string;
    title: string;
    folderPath: string[];
}
/** Any synchronized document. Used where only the page shape matters. */
export declare function anyDocument(): CorpusFixture;
/**
 * A document that sits in a Drive folder, which is what gives a page a
 * breadcrumb trail with somewhere to point.
 */
export declare function documentInFolder(): CorpusFixture | undefined;
/**
 * A document whose body carries a Markdown table.
 *
 * Which document that is depends on the corpus, so it is found by reading the
 * generated Markdown rather than named here. The delimiter row is the reliable
 * marker: a table cannot exist without one, and no other construct has one.
 */
export declare function documentWithTable(): CorpusFixture | undefined;
/** A document with a generated image, and the published path of that image. */
export declare function documentWithAsset(): {
    document: CorpusFixture;
    assetPath: string;
} | undefined;

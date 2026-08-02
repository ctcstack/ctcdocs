import { z } from 'zod';
export const aiDocsIndexSchema = z.object({
    schemaVersion: z.literal(1),
    generatedAt: z.iso.datetime(),
    documents: z.array(z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        slug: z.string().min(1),
        markdownPath: z.string().min(1),
        sourceUrl: z.url(),
        googleModifiedTime: z.iso.datetime(),
        syncedAt: z.iso.datetime(),
        contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
        folderPath: z.array(z.string()),
        language: z.string().min(2).optional(),
    })),
});
export function createAiDocsIndex(manifest, folderPaths, defaultLocale) {
    return {
        schemaVersion: 1,
        generatedAt: manifest.generatedAt,
        documents: Object.values(manifest.documents)
            .sort((left, right) => left.stableSlug < right.stableSlug
            ? -1
            : left.stableSlug > right.stableSlug
                ? 1
                : left.googleFileId < right.googleFileId
                    ? -1
                    : 1)
            .map((record) => ({
            id: record.googleFileId,
            title: record.displayTitle,
            slug: record.stableSlug,
            markdownPath: record.generatedMarkdownPath,
            sourceUrl: record.sourceUrl,
            googleModifiedTime: record.googleModifiedTime,
            syncedAt: record.lastSuccessfulSyncAt,
            contentHash: record.contentHash,
            folderPath: folderPaths.get(record.googleFileId) ?? [],
            language: defaultLocale,
        })),
    };
}
export function serializeAiDocsIndex(index) {
    return `${JSON.stringify(index, null, 2)}\n`;
}

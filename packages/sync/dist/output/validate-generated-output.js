import { readFile, readdir } from 'node:fs/promises';
import { posix, relative, resolve } from 'node:path';
import { PROJECT_LAYOUT } from '@ctcstack/ctcdocs-core';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { aiDocsIndexSchema } from '../generation/ai-index.js';
import { createRedirectMap, serializeRedirectMap, } from '../generation/redirects.js';
import { syncReportSchema } from '../generation/sync-report.js';
import { validateImageAsset } from '../assets/validate-asset.js';
import { findBrokenInternalLinks } from '../links/validate-internal-links.js';
import { collectMarkdownImageUrls } from '../markdown/analyze-markdown.js';
import { computeGeneratedContentHash, extractGeneratedDocumentBody, sha256, } from '../markdown/generated-document.js';
import { syncManifestSchema } from '../manifest.js';
/**
 * The published shape of a generated image: one directory per Google file
 * identifier, holding numbered images the converter named. Anything else in a
 * document's image URL is a rewriting bug or an escape attempt, and either way
 * must not reach the site.
 */
const generatedAssetPattern = new RegExp(`^${PROJECT_LAYOUT.generatedAssetsDirectory.replaceAll('/', '\\/')}\\/[A-Za-z0-9_-]+\\/image-\\d{3}\\.(?:gif|jpg|png|svg|webp)$`, 'u');
const frontmatterSchema = z.object({
    title: z.string().min(1),
    description: z.string().min(1).optional(),
    slug: z.string().min(1),
    editUrl: z.url(),
    sourceType: z.literal('google-doc'),
    googleFileId: z.string().min(1),
    googleModifiedTime: z.iso.datetime(),
    syncedAt: z.iso.datetime(),
    contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    folderPath: z.array(z.string()),
    pagefind: z.literal(true),
});
/*
 * A section page reports no provenance: it is not a Google Doc, so it carries
 * neither an edit URL nor a synchronization time, and it is kept out of the
 * search index because every line in it is a title that already ranks on its
 * own. The schema is strict so that a page which quietly grew one of those
 * fields fails here instead of publishing a broken edit link.
 */
const sectionFrontmatterSchema = z.strictObject({
    title: z.string().min(1),
    slug: z.string().min(1),
    sourceType: z.literal('section-index'),
    contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    folderPath: z.array(z.string()),
    pagefind: z.literal(false),
});
export class GeneratedOutputValidationError extends Error {
    name = 'GeneratedOutputValidationError';
}
function parseFrontmatter(content, markdownHeader) {
    const lines = content.split('\n');
    if (lines[0] !== '---') {
        throw new Error('Generated Markdown must start with YAML frontmatter.');
    }
    const closingIndex = lines.indexOf('---', 1);
    if (closingIndex < 0) {
        throw new Error('Generated Markdown frontmatter is not closed.');
    }
    const firstBodyLine = lines
        .slice(closingIndex + 1)
        .find((line) => line.length > 0);
    if (firstBodyLine !== markdownHeader) {
        throw new Error('Generated Markdown has no ownership header.');
    }
    return parseYaml(lines.slice(1, closingIndex).join('\n'));
}
async function collectAssetFiles(assetRoot, current = assetRoot) {
    const files = new Map();
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
        const path = resolve(current, entry.name);
        if (entry.isSymbolicLink()) {
            throw new Error('Generated assets must not contain symbolic links.');
        }
        if (entry.isDirectory()) {
            for (const [nestedPath, bytes] of await collectAssetFiles(assetRoot, path)) {
                files.set(nestedPath, bytes);
            }
        }
        else if (entry.isFile()) {
            files.set(`${PROJECT_LAYOUT.generatedAssetsDirectory}/${relative(assetRoot, path).replaceAll('\\', '/')}`, await readFile(path));
        }
        else {
            throw new Error('Generated assets contain an unsupported entry.');
        }
    }
    return files;
}
async function validateGeneratedOutputInternal(stagedRepositoryRoot, context) {
    const { markdownHeader, sourceHeader } = context;
    const manifest = syncManifestSchema.parse(JSON.parse(await readFile(resolve(stagedRepositoryRoot, PROJECT_LAYOUT.manifestFile), 'utf8')));
    const aiIndex = aiDocsIndexSchema.parse(JSON.parse(await readFile(resolve(stagedRepositoryRoot, 'data/docs-index.json'), 'utf8')));
    syncReportSchema.parse(JSON.parse(await readFile(resolve(stagedRepositoryRoot, 'data/latest-sync-report.json'), 'utf8')));
    const generatedDirectory = resolve(stagedRepositoryRoot, 'src/content/docs/_generated');
    const generatedFileNames = (await readdir(generatedDirectory)).sort();
    const expectedFileNames = [
        ...Object.values(manifest.documents).map((record) => `${record.googleFileId}.md`),
        ...Object.values(manifest.folders)
            .map((record) => record.generatedMarkdownPath)
            .filter((path) => path !== undefined)
            .map((path) => path.split('/').at(-1) ?? path),
    ].sort();
    if (JSON.stringify(generatedFileNames) !== JSON.stringify(expectedFileNames)) {
        throw new Error('Generated Markdown files do not exactly match the sync manifest.');
    }
    const slugs = new Set();
    /*
     * Folders share the document namespace — `/company/` and a document called
     * "Company" are one URL — so their addresses are reserved here before any
     * document claims one, and the root is the only folder without an address.
     */
    for (const folder of Object.values(manifest.folders)) {
        if (folder.googleFolderId === manifest.rootFolderId) {
            continue;
        }
        if (!folder.stableSlug) {
            throw new Error('Manifest contains a folder without a stable slug.');
        }
        if (slugs.has(folder.stableSlug)) {
            throw new Error('Generated output contains duplicate stable slugs.');
        }
        slugs.add(folder.stableSlug);
    }
    const assetRoot = resolve(stagedRepositoryRoot, PROJECT_LAYOUT.generatedAssetsDirectory);
    const allAssets = await collectAssetFiles(assetRoot);
    const referencedAssets = new Set();
    const linkDocuments = [];
    for (const record of Object.values(manifest.documents)) {
        if (slugs.has(record.stableSlug)) {
            throw new Error('Generated output contains duplicate stable slugs.');
        }
        slugs.add(record.stableSlug);
        const expectedPath = `src/content/docs/_generated/${record.googleFileId}.md`;
        const expectedAssetsDirectory = `${PROJECT_LAYOUT.generatedAssetsDirectory}/${record.googleFileId}`;
        if (record.generatedMarkdownPath !== expectedPath) {
            throw new Error('Manifest contains an invalid generated Markdown path.');
        }
        if (record.generatedAssetsDirectory !== expectedAssetsDirectory) {
            throw new Error('Manifest contains an invalid generated assets path.');
        }
        const content = await readFile(resolve(stagedRepositoryRoot, expectedPath), 'utf8');
        if (sha256(content) !== record.outputHash) {
            throw new Error('Generated Markdown does not match its output hash.');
        }
        const frontmatter = frontmatterSchema.parse(parseFrontmatter(content, markdownHeader));
        if (frontmatter.googleFileId !== record.googleFileId ||
            frontmatter.slug !== record.stableSlug ||
            frontmatter.contentHash !== record.contentHash) {
            throw new Error('Generated frontmatter does not match the manifest.');
        }
        const body = extractGeneratedDocumentBody(content, markdownHeader);
        if (body === undefined) {
            throw new Error('Generated Markdown body cannot be identified.');
        }
        const documentAssets = new Map();
        for (const imageUrl of collectMarkdownImageUrls(body)) {
            const repositoryPath = posix.normalize(posix.join(posix.dirname(expectedPath), imageUrl));
            if (!repositoryPath.startsWith(`${expectedAssetsDirectory}/`) ||
                !generatedAssetPattern.test(repositoryPath)) {
                throw new Error('Generated Markdown contains an invalid asset URL.');
            }
            const bytes = allAssets.get(repositoryPath);
            if (!bytes) {
                throw new Error('Generated Markdown references a missing asset.');
            }
            validateImageAsset(repositoryPath, bytes);
            referencedAssets.add(repositoryPath);
            documentAssets.set(repositoryPath, bytes);
        }
        if (computeGeneratedContentHash(body, [...documentAssets].map(([repositoryPath, bytes]) => ({
            repositoryPath,
            bytes,
        }))) !== record.contentHash) {
            throw new Error('Generated Markdown and assets do not match the content hash.');
        }
        linkDocuments.push({ body, stableSlug: record.stableSlug });
    }
    for (const folder of Object.values(manifest.folders)) {
        if (!folder.generatedMarkdownPath || !folder.stableSlug) {
            continue;
        }
        const content = await readFile(resolve(stagedRepositoryRoot, folder.generatedMarkdownPath), 'utf8');
        const frontmatter = sectionFrontmatterSchema.parse(parseFrontmatter(content, markdownHeader));
        if (folder.generatedMarkdownPath !==
            `src/content/docs/_generated/section-${folder.googleFolderId}.md` ||
            frontmatter.slug !== folder.stableSlug ||
            frontmatter.title !== folder.displayLabel) {
            throw new Error('Generated section page does not match the manifest.');
        }
        const body = extractGeneratedDocumentBody(content, markdownHeader);
        if (body === undefined) {
            throw new Error('Generated Markdown body cannot be identified.');
        }
        if (computeGeneratedContentHash(body.trimEnd(), []) !==
            frontmatter.contentHash) {
            throw new Error('Generated section page does not match its own hash.');
        }
        linkDocuments.push({ body, stableSlug: folder.stableSlug });
    }
    if ([...allAssets.keys()].some((repositoryPath) => !referencedAssets.has(repositoryPath))) {
        throw new Error('Generated output contains an orphan asset.');
    }
    for (const [sourceSlug, redirect] of Object.entries(manifest.redirects)) {
        if (slugs.has(sourceSlug) ||
            sourceSlug === redirect.targetSlug ||
            manifest.documents[redirect.googleFileId]?.stableSlug !==
                redirect.targetSlug) {
            throw new Error('Generated redirect metadata is invalid.');
        }
    }
    if (findBrokenInternalLinks(linkDocuments, new Set(Object.keys(manifest.redirects))).length > 0) {
        throw new Error('Generated output contains a broken internal page link.');
    }
    if (aiIndex.documents.length !== Object.keys(manifest.documents).length ||
        aiIndex.documents.some((entry) => manifest.documents[entry.id]?.generatedMarkdownPath !==
            entry.markdownPath)) {
        throw new Error('AI index does not match the sync manifest.');
    }
    const sidebar = await readFile(resolve(stagedRepositoryRoot, `${PROJECT_LAYOUT.generatedSourceDirectory}/sidebar.ts`), 'utf8');
    if (!sidebar.startsWith(sourceHeader)) {
        throw new Error('Generated sidebar has no ownership header.');
    }
    const redirects = await readFile(resolve(stagedRepositoryRoot, `${PROJECT_LAYOUT.generatedSourceDirectory}/redirects.ts`), 'utf8');
    if (redirects !==
        serializeRedirectMap(createRedirectMap(manifest), sourceHeader)) {
        throw new Error('Generated redirect module does not match the manifest.');
    }
}
export async function validateGeneratedOutput(stagedRepositoryRoot, context) {
    try {
        await validateGeneratedOutputInternal(stagedRepositoryRoot, context);
    }
    catch (error) {
        if (error instanceof GeneratedOutputValidationError) {
            throw error;
        }
        throw new GeneratedOutputValidationError(error instanceof Error
            ? error.message
            : 'Generated output validation failed.', { cause: error });
    }
}

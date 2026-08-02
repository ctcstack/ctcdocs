import { createHash } from 'node:crypto';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
export function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
export function computeGeneratedContentHash(body, assets) {
    return sha256(JSON.stringify({
        body,
        assets: [...assets]
            .sort((left, right) => left.repositoryPath < right.repositoryPath
            ? -1
            : left.repositoryPath > right.repositoryPath
                ? 1
                : 0)
            .map((asset) => ({
            path: asset.repositoryPath,
            hash: sha256(asset.bytes),
        })),
    }));
}
export function extractGeneratedDocumentBody(content, markdownHeader) {
    const marker = `${markdownHeader}\n\n`;
    const markerIndex = content.indexOf(marker);
    return markerIndex < 0
        ? undefined
        : content.slice(markerIndex + marker.length);
}
export function extractGeneratedFolderPath(content) {
    const lines = content.split('\n');
    if (lines[0] !== '---') {
        return undefined;
    }
    const closingIndex = lines.indexOf('---', 1);
    if (closingIndex < 0) {
        return undefined;
    }
    let parsed;
    try {
        parsed = parseYaml(lines.slice(1, closingIndex).join('\n'));
    }
    catch {
        return undefined;
    }
    if (typeof parsed !== 'object' ||
        parsed === null ||
        !('folderPath' in parsed) ||
        !Array.isArray(parsed.folderPath) ||
        !parsed.folderPath.every((segment) => typeof segment === 'string')) {
        return undefined;
    }
    return parsed.folderPath;
}
export function generateMarkdownDocument(input, markdownHeader) {
    const contentHash = input.contentHash ?? sha256(input.normalizedBody);
    const body = input.normalizedBody.trimEnd();
    const frontmatter = stringifyYaml({
        title: input.title,
        ...(input.description ? { description: input.description } : {}),
        slug: input.slug,
        editUrl: input.sourceUrl,
        sourceType: 'google-doc',
        googleFileId: input.googleFileId,
        googleModifiedTime: input.googleModifiedTime,
        syncedAt: input.syncedAt,
        contentHash,
        folderPath: input.folderPath,
        pagefind: true,
    }, {
        defaultStringType: 'QUOTE_DOUBLE',
        lineWidth: 0,
    });
    return [
        '---',
        frontmatter.trimEnd(),
        '---',
        markdownHeader,
        '',
        ...(body ? [body, ''] : ['']),
    ].join('\n');
}

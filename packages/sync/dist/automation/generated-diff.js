import { isGeneratedPathAllowed, normalizeRepositoryPath, } from '@ctcstack/ctcdocs-core';
export class GeneratedDiffValidationError extends Error {
    rejectedPaths;
    name = 'GeneratedDiffValidationError';
    constructor(rejectedPaths) {
        super(`Generated diff contains non-allowlisted paths: ${rejectedPaths.join(', ')}`);
        this.rejectedPaths = rejectedPaths;
    }
}
export function validateGeneratedDiffPaths(paths) {
    const normalizedPaths = [
        ...new Set(paths.map((path) => {
            const normalized = normalizeRepositoryPath(path);
            return normalized ?? path;
        })),
    ].sort((left, right) => left.localeCompare(right, 'en'));
    const rejectedPaths = normalizedPaths.filter((path) => !isGeneratedPathAllowed(path));
    if (rejectedPaths.length > 0) {
        throw new GeneratedDiffValidationError(rejectedPaths);
    }
    return normalizedPaths;
}

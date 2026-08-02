import { posix } from 'node:path';
import { GENERATED_DIRECTORY_ALLOWLIST, GENERATED_FILE_ALLOWLIST, } from './project-layout.js';
export function normalizeRepositoryPath(input) {
    if (input.length === 0 || input.includes('\\') || input.startsWith('/')) {
        return undefined;
    }
    const normalized = posix.normalize(input);
    if (normalized === '.' ||
        normalized === '..' ||
        normalized.startsWith('../')) {
        return undefined;
    }
    return normalized;
}
export function isGeneratedPathAllowed(input) {
    const normalized = normalizeRepositoryPath(input);
    if (normalized === undefined) {
        return false;
    }
    if (GENERATED_FILE_ALLOWLIST.some((allowedPath) => normalized === allowedPath)) {
        return true;
    }
    return GENERATED_DIRECTORY_ALLOWLIST.some((allowedDirectory) => normalized === allowedDirectory ||
        normalized.startsWith(`${allowedDirectory}/`));
}
export function assertGeneratedPathAllowed(input) {
    if (!isGeneratedPathAllowed(input)) {
        throw new Error(`Generated output path is not allowed: ${input}`);
    }
}

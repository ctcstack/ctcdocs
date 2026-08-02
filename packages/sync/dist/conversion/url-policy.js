import { posix } from 'node:path';
const ABSOLUTE_SCHEME = /^[a-z][a-z0-9+.-]*:/iu;
const SAFE_LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:']);
const POLICY_BASE_URL = 'https://archive.invalid/';
function containsControlCharacter(value) {
    return [...value].some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 31 || codePoint === 127;
    });
}
export function isAllowedLinkUrl(value) {
    if (value.length === 0 ||
        value !== value.trim() ||
        value.startsWith('//') ||
        value.includes('\\') ||
        containsControlCharacter(value)) {
        return false;
    }
    try {
        const parsed = new URL(value, POLICY_BASE_URL);
        return (!ABSOLUTE_SCHEME.test(value) || SAFE_LINK_SCHEMES.has(parsed.protocol));
    }
    catch {
        return false;
    }
}
export function resolveArchiveAssetPath(htmlPath, value) {
    if (value.length === 0 ||
        value !== value.trim() ||
        value.startsWith('/') ||
        value.startsWith('//') ||
        value.startsWith('#') ||
        value.includes('\\') ||
        value.includes('?') ||
        value.includes('#') ||
        ABSOLUTE_SCHEME.test(value) ||
        containsControlCharacter(value)) {
        return undefined;
    }
    let decoded;
    try {
        decoded = decodeURIComponent(value);
    }
    catch {
        return undefined;
    }
    if (decoded.split('/').some((segment) => segment === '..') ||
        decoded.includes('\0')) {
        return undefined;
    }
    const resolved = posix
        .normalize(posix.join(posix.dirname(htmlPath), decoded))
        .normalize('NFC');
    return resolved === '.' ||
        resolved === '..' ||
        resolved.startsWith('../') ||
        resolved.startsWith('/')
        ? undefined
        : resolved;
}
export function isAllowedSvgReference(value) {
    return (value.startsWith('#') &&
        value.length > 1 &&
        !containsControlCharacter(value));
}

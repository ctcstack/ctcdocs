import * as cheerio from 'cheerio';
import { Element } from 'domhandler';
import { isAllowedSvgReference } from '../conversion/url-policy.js';
const SAFE_SVG_ELEMENTS = new Set([
    'circle',
    'clippath',
    'defs',
    'desc',
    'ellipse',
    'g',
    'line',
    'lineargradient',
    'mask',
    'path',
    'pattern',
    'polygon',
    'polyline',
    'radialgradient',
    'rect',
    'stop',
    'svg',
    'text',
    'title',
    'tspan',
    'use',
]);
export class UnsafeAssetError extends Error {
    name = 'UnsafeAssetError';
}
function startsWith(bytes, signature) {
    return signature.every((value, index) => bytes[index] === value);
}
function sortElementAttributes($) {
    $('*').each((_, element) => {
        if (!(element instanceof Element)) {
            return;
        }
        element.attribs = Object.fromEntries(Object.entries(element.attribs).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
    });
}
function validateSvg(bytes) {
    let source;
    try {
        source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    }
    catch (error) {
        throw new UnsafeAssetError('SVG is not valid UTF-8.', { cause: error });
    }
    if (source.toLocaleLowerCase('en').includes('<!doctype')) {
        throw new UnsafeAssetError('SVG document types are not supported.');
    }
    const $ = cheerio.load(source, { xml: true });
    const rootElements = $.root().children();
    const rootElement = rootElements.get(0);
    if (rootElements.length !== 1 ||
        !(rootElement instanceof Element) ||
        rootElement.name.toLocaleLowerCase('en') !== 'svg') {
        throw new UnsafeAssetError('SVG must contain exactly one root element.');
    }
    let unsafe = false;
    $('*').each((_, element) => {
        if (!(element instanceof Element)) {
            unsafe = true;
            return;
        }
        const elementName = element.name.toLocaleLowerCase('en');
        if (!SAFE_SVG_ELEMENTS.has(elementName)) {
            unsafe = true;
            return;
        }
        for (const [attributeName, value] of Object.entries(element.attribs)) {
            const normalizedName = attributeName.toLocaleLowerCase('en');
            const normalizedValue = value.trim();
            if (normalizedName.startsWith('on') ||
                normalizedName === 'style' ||
                ((normalizedName === 'href' || normalizedName === 'xlink:href') &&
                    !isAllowedSvgReference(normalizedValue)) ||
                (normalizedValue.toLocaleLowerCase('en').includes('url(') &&
                    !/^url\(#[A-Za-z_][A-Za-z0-9_.:-]*\)$/u.test(normalizedValue))) {
                unsafe = true;
            }
        }
    });
    if (unsafe) {
        throw new UnsafeAssetError('SVG contains active or external content.');
    }
    sortElementAttributes($);
    return new TextEncoder().encode($.xml());
}
export function validateImageAsset(archivePath, bytes) {
    const extension = archivePath.split('.').at(-1)?.toLocaleLowerCase('en');
    if (extension === 'png' &&
        startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
        return { bytes, extension: 'png', mimeType: 'image/png' };
    }
    if ((extension === 'jpg' || extension === 'jpeg') &&
        startsWith(bytes, [0xff, 0xd8, 0xff])) {
        return { bytes, extension: 'jpg', mimeType: 'image/jpeg' };
    }
    if (extension === 'gif' &&
        (startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
            startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))) {
        return { bytes, extension: 'gif', mimeType: 'image/gif' };
    }
    if (extension === 'webp' &&
        startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
        new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP') {
        return { bytes, extension: 'webp', mimeType: 'image/webp' };
    }
    if (extension === 'svg') {
        return {
            bytes: validateSvg(bytes),
            extension: 'svg',
            mimeType: 'image/svg+xml',
        };
    }
    throw new UnsafeAssetError('Image MIME type does not match a supported extension.');
}

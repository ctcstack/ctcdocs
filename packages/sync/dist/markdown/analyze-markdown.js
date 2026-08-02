import * as cheerio from 'cheerio';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
const processor = unified().use(remarkParse).use(remarkGfm);
function walk(node, visit) {
    if (node.type !== 'root') {
        visit(node);
    }
    if ('children' in node) {
        for (const child of node.children) {
            walk(child, visit);
        }
    }
}
export function detectMarkdownFallbackReasons(input) {
    const source = typeof input === 'string'
        ? input
        : new TextDecoder('utf-8', { fatal: true }).decode(input);
    const tree = processor.parse(source);
    const reasons = new Set();
    walk(tree, (node) => {
        if (node.type === 'html') {
            reasons.add('html');
        }
        else if (node.type === 'image' || node.type === 'imageReference') {
            reasons.add('image');
        }
        else if (node.type === 'table') {
            reasons.add('table');
        }
    });
    return [...reasons].sort();
}
export function collectMarkdownImageUrls(input) {
    const tree = processor.parse(input);
    const definitions = new Map();
    walk(tree, (node) => {
        if (node.type === 'definition') {
            definitions.set(node.identifier.toLocaleLowerCase('en'), node.url);
        }
    });
    const urls = [];
    walk(tree, (node) => {
        if (node.type === 'image') {
            urls.push(node.url);
        }
        else if (node.type === 'imageReference') {
            const url = definitions.get(node.identifier.toLocaleLowerCase('en'));
            if (url) {
                urls.push(url);
            }
        }
        else if (node.type === 'html') {
            const $ = cheerio.load(node.value);
            $('img').each((_, image) => {
                const source = $(image).attr('src');
                if (source) {
                    urls.push(source);
                }
            });
        }
    });
    return urls;
}
export function collectMarkdownLinkUrls(input) {
    const tree = processor.parse(input);
    const definitions = new Map();
    walk(tree, (node) => {
        if (node.type === 'definition') {
            definitions.set(node.identifier.toLocaleLowerCase('en'), node.url);
        }
    });
    const urls = [];
    walk(tree, (node) => {
        if (node.type === 'link') {
            urls.push(node.url);
        }
        else if (node.type === 'linkReference') {
            const url = definitions.get(node.identifier.toLocaleLowerCase('en'));
            if (url) {
                urls.push(url);
            }
        }
        else if (node.type === 'html') {
            const $ = cheerio.load(node.value);
            $('a[href]').each((_, anchor) => {
                const href = $(anchor).attr('href');
                if (href) {
                    urls.push(href);
                }
            });
        }
    });
    return urls;
}

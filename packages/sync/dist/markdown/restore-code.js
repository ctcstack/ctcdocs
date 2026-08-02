import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
/**
 * Google Docs has no fenced code block. An author who wants one types the
 * backtick fence as ordinary text, and the Markdown export escapes every
 * backtick, so the block arrives as prose: `\`\`\`ts`.
 *
 * Restoration works on the export source rather than on the parsed tree,
 * because parsing discards exactly what a code block needs. A paragraph's
 * continuation lines lose their leading whitespace, so by the time remark has
 * produced a tree, indented code has already been flattened to the left
 * margin. The tree is still parsed first, and only the byte ranges of
 * top-level paragraphs are rewritten, so genuine fenced blocks, lists, tables,
 * and HTML blocks are never touched.
 */
const blockProcessor = unified().use(remarkParse).use(remarkGfm);
/**
 * The four ASCII punctuation ranges, which per CommonMark are the only
 * characters a backslash may escape.
 */
const MARKDOWN_ESCAPE = /\\([!-/:-@[-`{-~])/gu;
const TRAILING_BACKSLASHES = /\\+$/u;
const TRAILING_SPACE = /[ \t]+$/u;
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*([^`~]*)$/u;
const LANGUAGE = /^[a-z][a-z0-9+#._-]{0,29}$/u;
/** A fence was opened in the document and never closed. */
export const UNTERMINATED_CODE_FENCE = 'unterminated_code_fence';
/**
 * Removes the hard line break marker Google's export puts at the end of every
 * line of a soft-wrapped paragraph. A trailing backslash is a break only when
 * it is not itself escaped, so an odd-length run loses one backslash and an
 * even-length run is left alone.
 */
function stripHardBreak(line) {
    const backslashes = TRAILING_BACKSLASHES.exec(line);
    return backslashes && backslashes[0].length % 2 === 1
        ? line.slice(0, -1)
        : line.replace(TRAILING_SPACE, '');
}
function cleanLine(line) {
    return stripHardBreak(line).replace(MARKDOWN_ESCAPE, '$1');
}
function fenceDelimiter(cleaned) {
    const match = FENCE.exec(cleaned);
    const marker = match?.[1];
    return marker ? { info: (match[2] ?? '').trim(), marker } : undefined;
}
/**
 * Language tags reach the reader as a CSS class and a Shiki grammar name, so
 * anything that is not a plain identifier is dropped rather than passed on.
 */
function languageOf(info) {
    const candidate = info.split(/\s+/u)[0]?.toLocaleLowerCase('en') ?? '';
    return LANGUAGE.test(candidate) ? candidate : '';
}
function sliceNode(source, node) {
    const { start, end } = node.position ?? {};
    return start?.offset === undefined || end?.offset === undefined
        ? undefined
        : source.slice(start.offset, end.offset);
}
function renderCodeBlock(language, lines) {
    const longestRun = lines.reduce((longest, line) => [...line.matchAll(/`+/gu)].reduce((lineLongest, run) => Math.max(lineLongest, run[0].length), longest), 0);
    const fence = '`'.repeat(Math.max(3, longestRun + 1));
    return `${fence}${language}\n${lines.join('\n')}\n${fence}`;
}
/**
 * Locates every fence pair in a run of adjacent paragraphs. A pair may span
 * paragraphs, because an author who presses Enter between code lines produces
 * one paragraph per line.
 */
function findCodeRegions(lines, warnings) {
    const regions = [];
    let opened;
    for (const [index, line] of lines.entries()) {
        const delimiter = fenceDelimiter(line.cleaned);
        if (!delimiter) {
            continue;
        }
        if (!opened) {
            opened = {
                index,
                language: languageOf(delimiter.info),
                marker: delimiter.marker,
            };
            continue;
        }
        if (delimiter.info === '' &&
            delimiter.marker[0] === opened.marker[0] &&
            delimiter.marker.length >= opened.marker.length) {
            regions.push({
                end: index,
                language: opened.language,
                start: opened.index,
            });
            opened = undefined;
        }
    }
    if (opened) {
        warnings.add(UNTERMINATED_CODE_FENCE);
    }
    return regions;
}
function rewriteParagraphRun(run, source, warnings) {
    const lines = [];
    for (const [paragraphIndex, paragraph] of run.entries()) {
        const raw = sliceNode(source, paragraph);
        if (raw === undefined) {
            return undefined;
        }
        for (const line of raw.split('\n')) {
            lines.push({ cleaned: cleanLine(line), paragraphIndex, raw: line });
        }
    }
    const regions = findCodeRegions(lines, warnings);
    if (regions.length === 0) {
        return {
            blocks: run.map((paragraph) => sliceNode(source, paragraph) ?? ''),
            changed: false,
        };
    }
    const regionsByStart = new Map(regions.map((region) => [region.start, region]));
    const blocks = [];
    let prose = [];
    const flushProse = () => {
        if (prose.length > 0) {
            blocks.push(prose.map((line) => line.raw).join('\n'));
            prose = [];
        }
    };
    let index = 0;
    while (index < lines.length) {
        const region = regionsByStart.get(index);
        if (region) {
            flushProse();
            blocks.push(renderCodeBlock(region.language, lines.slice(region.start + 1, region.end).map((line) => line.cleaned)));
            index = region.end + 1;
            continue;
        }
        const line = lines[index];
        if (!line) {
            break;
        }
        if (prose.length > 0 && prose[0]?.paragraphIndex !== line.paragraphIndex) {
            flushProse();
        }
        prose.push(line);
        index += 1;
    }
    flushProse();
    return { blocks, changed: true };
}
/**
 * Rebuilds fenced code blocks that reached the export as escaped prose. The
 * source is returned unchanged when the document contains no reconstructable
 * fence, so documents without code produce byte-identical output.
 */
export function restoreCodeFences(source) {
    const tree = blockProcessor.parse(source);
    const warnings = new Set();
    const blocks = [];
    let run = [];
    let changed = false;
    const flushRun = () => {
        if (run.length === 0) {
            return true;
        }
        const rewritten = rewriteParagraphRun(run, source, warnings);
        if (!rewritten) {
            return false;
        }
        changed ||= rewritten.changed;
        blocks.push(...rewritten.blocks);
        run = [];
        return true;
    };
    for (const child of tree.children) {
        if (child.type === 'paragraph') {
            run.push(child);
            continue;
        }
        if (!flushRun()) {
            return { markdown: source, warnings: [...warnings].sort() };
        }
        const raw = sliceNode(source, child);
        if (raw === undefined) {
            return { markdown: source, warnings: [...warnings].sort() };
        }
        blocks.push(raw);
    }
    if (!flushRun()) {
        return { markdown: source, warnings: [...warnings].sort() };
    }
    return {
        markdown: changed ? `${blocks.join('\n\n')}\n` : source,
        warnings: [...warnings].sort(),
    };
}
function splitInlineCode(value) {
    const nodes = [];
    let cursor = 0;
    for (const match of value.matchAll(/`([^`\n]+)`/gu)) {
        const code = match[1];
        if (match.index === undefined || !code || code.trim() === '') {
            continue;
        }
        if (match.index > cursor) {
            nodes.push({ type: 'text', value: value.slice(cursor, match.index) });
        }
        nodes.push({ type: 'inlineCode', value: code });
        cursor = match.index + match[0].length;
    }
    if (nodes.length === 0) {
        return undefined;
    }
    if (cursor < value.length) {
        nodes.push({ type: 'text', value: value.slice(cursor) });
    }
    return nodes;
}
/**
 * Rebuilds inline code spans from the backticks the export escaped. Code
 * blocks are leaves, so a span inside one is never reached.
 */
export function restoreInlineCode(tree) {
    const visit = (node) => {
        const children = [];
        let changed = false;
        for (const child of node.children) {
            if (child.type === 'text') {
                const split = splitInlineCode(child.value);
                if (split) {
                    children.push(...split);
                    changed = true;
                    continue;
                }
            }
            else if ('children' in child) {
                visit(child);
            }
            children.push(child);
        }
        if (changed) {
            node.children = children;
        }
    };
    visit(tree);
}

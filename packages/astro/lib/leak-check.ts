/**
 * A build check that keeps a document's text inside its access class
 * (ADR-039).
 *
 * The map decides who may fetch each file; this decides whether a file says
 * more than its readers may know. A file fails when it holds a run of eight
 * words that appears only in documents its readers may not open: a
 * description on an index, an excerpt on a listing, a heading quoted on a
 * report. Titles, folder names and addresses may appear anywhere, so runs that
 * lie wholly inside them are not evidence.
 *
 * The comparison is by word runs within one block of text — a paragraph, a
 * list item, a table cell, an attribute — so two neighbouring titles in a
 * sidebar never join into a run that no document holds. A failure names the
 * file, the document and the word offset, never the words: build logs are not
 * a place for document bodies.
 */
import {
  EVERY_MEMBER,
  MEMBERS_CLASS,
  ADMINS_CLASS,
} from '@ctcstack/ctcdocs-core';
import type { Readers } from '@ctcstack/ctcdocs-core';
import * as cheerio from 'cheerio';

/** The parts of a parsed HTML node this check reads. */
interface DomNode {
  readonly type: string;
  readonly data?: string;
  readonly name?: string;
  readonly attribs?: Readonly<Record<string, string>>;
  readonly children?: readonly DomNode[];
}

/** Words in a run; eight is long enough to be a sentence, not a phrase. */
export const RUN_LENGTH = 8;

const BLOCK = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'br',
  'dd',
  'details',
  'dialog',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'option',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'title',
  'tr',
  'ul',
  'body',
  'html',
  'head',
  'button',
  'label',
  'select',
  'textarea',
  'caption',
  'picture',
  'svg',
]);
const SKIPPED = new Set(['script', 'style', 'template', 'noscript']);
const TEXT_ATTRIBUTES = [
  'alt',
  'title',
  'aria-label',
  'content',
  'placeholder',
];

/** The words of a text, as search would read them. */
export function words(text: string): string[] {
  return (
    text
      .normalize('NFKC')
      .toLowerCase()
      .match(/[\p{L}\p{M}\p{N}]+/gu) ?? []
  );
}

function runs(segment: readonly string[]): string[] {
  const found: string[] = [];
  for (let start = 0; start + RUN_LENGTH <= segment.length; start += 1) {
    found.push(segment.slice(start, start + RUN_LENGTH).join(' '));
  }
  return found;
}

/**
 * Blocks of text in an HTML page: block elements break a block, inline ones
 * do not; attributes that people or agents read are blocks of their own, and
 * JSON-LD is read as text, since it carries a page's description. With
 * `selector`, only that part of the page is read.
 */
export function htmlSegments(html: string, selector?: string): string[] {
  const $ = cheerio.load(html);
  const segments: string[] = [];
  let current = '';
  const flush = () => {
    if (current.trim()) {
      segments.push(current);
    }
    current = '';
  };
  const visit = (node: DomNode) => {
    if (node.type === 'text') {
      current += node.data ?? '';
      return;
    }
    const name = node.name?.toLowerCase() ?? '';
    const attributes = node.attribs ?? {};
    for (const attribute of TEXT_ATTRIBUTES) {
      const value = attributes[attribute];
      if (value) {
        segments.push(value);
      }
    }
    if (name === 'script' && attributes.type === 'application/ld+json') {
      flush();
      for (const child of node.children ?? []) {
        if (child.type === 'text' && child.data) {
          segments.push(child.data);
        }
      }
      return;
    }
    if (SKIPPED.has(name) || node.type === 'comment') {
      return;
    }
    const block = BLOCK.has(name);
    if (block) {
      flush();
    }
    for (const child of node.children ?? []) {
      visit(child);
    }
    if (block) {
      flush();
    }
  };
  const roots = (selector
    ? $(selector).toArray()
    : $.root().toArray()) as unknown as DomNode[];
  for (const root of roots) {
    visit(root);
    flush();
  }
  return segments;
}

/** Blocks of a plain text file: its lines, or its paragraphs for Markdown. */
export function textSegments(text: string, markdown: boolean): string[] {
  return text
    .split(markdown ? /\n\s*\n/u : /\n/u)
    .filter((segment) => segment.trim());
}

export interface LeakDocument {
  readonly path: string;
  readonly cls: string;
  readonly segments: readonly string[];
}

export interface LeakFile {
  readonly path: string;
  /** The file's class, or `platform` for a file every reader gets. */
  readonly cls: string;
  readonly segments: readonly string[];
}

export interface Leak {
  readonly file: string;
  readonly fileClass: string;
  readonly document: string;
  readonly documentClass: string;
  /** Offset of the run's first word in the file's block. */
  readonly offset: number;
}

export interface LeakCheckInput {
  /** Document bodies, every class including members. */
  readonly documents: readonly LeakDocument[];
  /** Files to read, with their classes. */
  readonly files: readonly LeakFile[];
  /** Titles, folder names, addresses and site strings, which may go anywhere. */
  readonly allowed: readonly string[];
  readonly readers: (cls: string) => Readers | undefined;
}

/** Whether everyone who reads `inner` may also read `outer`. */
function within(inner: Readers | undefined, outer: Readers | undefined) {
  if (outer === EVERY_MEMBER) {
    return true;
  }
  if (inner === undefined || outer === undefined || inner === EVERY_MEMBER) {
    return false;
  }
  // An empty set is the admins' class, readable by admins alone.
  return inner.every((group) => outer.includes(group));
}

export function findLeaks(input: LeakCheckInput): Leak[] {
  const allowed = new Set(input.allowed.flatMap((text) => runs(words(text))));
  const open = new Set<string>();
  const owners = new Map<string, { classes: Set<string>; document: string }>();
  for (const document of input.documents) {
    for (const segment of document.segments) {
      for (const run of runs(words(segment))) {
        if (document.cls === MEMBERS_CLASS) {
          open.add(run);
          continue;
        }
        const owner = owners.get(run);
        if (owner) {
          owner.classes.add(document.cls);
        } else {
          owners.set(run, {
            classes: new Set([document.cls]),
            document: document.path,
          });
        }
      }
    }
  }
  for (const run of [...owners.keys()]) {
    if (open.has(run) || allowed.has(run)) {
      owners.delete(run);
    }
  }

  const leaks: Leak[] = [];
  const checked = new Map<string, Leak | null>();
  for (const file of input.files) {
    if (file.cls === ADMINS_CLASS) {
      continue;
    }
    const fileReaders =
      file.cls === MEMBERS_CLASS || file.cls === 'platform'
        ? EVERY_MEMBER
        : input.readers(file.cls);
    for (const segment of file.segments) {
      const key = `${file.cls}\u0000${segment}`;
      let leak = checked.get(key);
      if (leak === undefined) {
        leak = null;
        const segmentWords = words(segment);
        const segmentRuns = runs(segmentWords);
        for (let offset = 0; offset < segmentRuns.length; offset += 1) {
          const owner = owners.get(segmentRuns[offset] as string);
          if (!owner || owner.classes.has(file.cls)) {
            continue;
          }
          const covered = [...owner.classes].some((cls) =>
            within(fileReaders, input.readers(cls)),
          );
          if (!covered) {
            leak = {
              file: file.path,
              fileClass: file.cls,
              document: owner.document,
              documentClass: [...owner.classes].sort().join(', '),
              offset,
            };
            break;
          }
        }
        checked.set(key, leak);
      }
      if (leak) {
        leaks.push({ ...leak, file: file.path });
        break;
      }
    }
  }
  return leaks;
}

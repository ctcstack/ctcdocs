/**
 * The page of a video or audio file (ADR-047), written from what Drive says
 * about it: the file is never downloaded.
 *
 * The page opens with a sentence of facts and goes on with the description its
 * editor wrote in Drive. The text is built into a Markdown tree and
 * serialized, never concatenated into Markdown, so nothing in a description
 * becomes markup. Its web and mail addresses become links in the tree, by
 * GFM's own rule for them, before it is serialized: an address found after
 * serialization would carry the escapes Markdown puts before `*`.
 */
import type { Paragraph, PhrasingContent, Root } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';

import {
  GOOGLE_VIDS_MIME_TYPE,
  mediaKind,
  type DriveItem,
} from '../google/drive-types.js';
import {
  sha256,
  type GeneratedMediaFacts,
} from '../markdown/generated-document.js';
import {
  isSafeUrl,
  truncateDescription,
} from '../markdown/normalize-markdown.js';

/**
 * The version of the page this module writes. A recording whose page was
 * written by an earlier version is written again.
 */
const MEDIA_VERSION = 2;

/** Description text beyond this is left out of the page. */
const MAX_DESCRIPTION_CHARACTERS = 20_000;

const markdownProcessor = unified().use(remarkGfm).use(remarkStringify, {
  bullet: '-',
  emphasis: '*',
  fences: true,
  listItemIndent: 'one',
  strong: '*',
});

/*
 * GFM finds web and mail addresses in text after parsing, in transforms over
 * the tree. They are taken from remark-gfm itself, so a description's
 * addresses are found exactly as a document's are.
 */
type TreeTransform = (tree: Root) => void;
const addressTransforms: readonly TreeTransform[] = (() => {
  const processor = unified().use(remarkGfm);
  processor.freeze();
  const extensions = (
    processor.data() as { fromMarkdownExtensions?: unknown[] }
  ).fromMarkdownExtensions;
  return (extensions ?? [])
    .flat(Infinity)
    .flatMap(
      (extension) =>
        (extension as { transforms?: TreeTransform[] }).transforms ?? [],
    );
})();

/** What Drive reports about a recording, as its page records it. */
export function mediaFacts(item: DriveItem): GeneratedMediaFacts {
  const kind = mediaKind(item.mimeType);
  if (!kind) {
    throw new Error('The file is not a video or audio file.');
  }
  const video = item.videoMediaMetadata;
  const milliseconds = video?.durationMillis;
  const width = video?.width ?? 0;
  const height = video?.height ?? 0;
  const sized = width > 0 && height > 0;
  return {
    kind,
    vids: item.mimeType === GOOGLE_VIDS_MIME_TYPE,
    seconds:
      milliseconds === undefined || milliseconds <= 0
        ? null
        : Math.max(1, Math.round(milliseconds / 1000)),
    width: sized ? width : null,
    height: sized ? height : null,
  };
}

function checksumOf(
  facts: GeneratedMediaFacts,
  description: string | undefined,
): string {
  return sha256(
    JSON.stringify({
      version: MEDIA_VERSION,
      facts,
      description: description ?? '',
    }),
  );
}

/**
 * A digest of everything the page is written from, so a page is written again
 * exactly when it would come out differently, even should Drive not report
 * the file modified.
 */
export function mediaChecksum(item: DriveItem): string {
  return checksumOf(mediaFacts(item), item.description);
}

/** `4 min 12 s`, `45 s`, `1 h 2 min`. */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) {
    return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  }
  if (minutes > 0) {
    return rest > 0 ? `${minutes} min ${rest} s` : `${minutes} min`;
  }
  return `${rest} s`;
}

/** The sentence that opens the page: what it is, and where it plays. */
function factsSentence(facts: GeneratedMediaFacts): string {
  const what = facts.vids
    ? 'A Google Vids video'
    : facts.kind === 'audio'
      ? 'An audio recording'
      : 'A video';
  const details = [
    ...(facts.seconds === null
      ? []
      : [`${formatDuration(facts.seconds)} long`]),
    ...(facts.width === null || facts.height === null
      ? []
      : [`${facts.width} × ${facts.height}`]),
  ];
  const where = facts.vids ? 'Google Vids' : 'Google Drive';
  return `${[what, ...details].join(', ')}. It plays in ${where}.`;
}

/** The description's lines, each a paragraph, within the page's limit. */
function descriptionParagraphs(description: string | undefined): string[] {
  const paragraphs: string[] = [];
  let characters = 0;
  for (const line of (description ?? '').split(/\r?\n/u)) {
    const text = line.replace(/\s+/gu, ' ').trim();
    if (!text) {
      continue;
    }
    if (characters + text.length > MAX_DESCRIPTION_CHARACTERS) {
      break;
    }
    characters += text.length;
    paragraphs.push(text);
  }
  return paragraphs;
}

/** A link GFM found to an address the site does not link to is text again. */
function keepSafeLinks(children: PhrasingContent[]): PhrasingContent[] {
  return children.map((child) =>
    child.type === 'link' && !isSafeUrl(child.url)
      ? {
          type: 'text',
          value: child.children
            .map((part) => (part.type === 'text' ? part.value : ''))
            .join(''),
        }
      : child,
  );
}

export interface MediaPage {
  facts: GeneratedMediaFacts;
  /** What `mediaChecksum` returns for the same file. */
  checksum: string;
  body: string;
  /** The description's first paragraph, the page's summary. */
  description?: string;
}

/** The page of a recording, from its Drive metadata. */
export function mediaPage(item: DriveItem): MediaPage {
  const facts = mediaFacts(item);
  const paragraphs = descriptionParagraphs(item.description);
  const tree: Root = {
    type: 'root',
    children: [factsSentence(facts), ...paragraphs].map((value): Paragraph => ({
      type: 'paragraph',
      children: [{ type: 'text', value }],
    })),
  };
  for (const transform of addressTransforms) {
    transform(tree);
  }
  for (const paragraph of tree.children) {
    if (paragraph.type === 'paragraph') {
      paragraph.children = keepSafeLinks(paragraph.children);
    }
  }
  const [first] = paragraphs;
  return {
    facts,
    checksum: checksumOf(facts, item.description),
    // One final newline, as every generated body ends.
    body: `${markdownProcessor.stringify(tree).trimEnd()}\n`,
    ...(first ? { description: truncateDescription(first) } : {}),
  };
}

/**
 * The page of a video or audio file (ADR-047), written from what Drive says
 * about it: the file is never downloaded.
 *
 * The page opens with a sentence of facts and goes on with the description its
 * editor wrote in Drive. The text is built into a Markdown tree and
 * serialized, never concatenated into Markdown, so nothing in a description
 * becomes markup; a web address in it becomes a link when the page is read
 * with GFM, as in any document.
 */
import type { Paragraph, Root } from 'mdast';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';

import {
  GOOGLE_VIDS_MIME_TYPE,
  mediaKind,
  type DriveItem,
  type MediaKind,
} from '../google/drive-types.js';
import {
  sha256,
  type GeneratedMediaFacts,
} from '../markdown/generated-document.js';
import { truncateDescription } from '../markdown/normalize-markdown.js';

/**
 * The version of the page this module writes. A recording whose page was
 * written by an earlier version is written again.
 */
const MEDIA_VERSION = 1;

/** Description text beyond this is left out of the page. */
const MAX_DESCRIPTION_CHARACTERS = 20_000;

const markdownProcessor = unified().use(remarkStringify, {
  bullet: '-',
  emphasis: '*',
  fences: true,
  listItemIndent: 'one',
  strong: '*',
});

/** What Drive reports about a recording, as its page records it. */
export function mediaFacts(item: DriveItem): GeneratedMediaFacts {
  const kind: MediaKind = mediaKind(item.mimeType) ?? 'video';
  const video = item.videoMediaMetadata;
  const milliseconds = video?.durationMillis;
  const width = video?.width ?? 0;
  const height = video?.height ?? 0;
  const sized = width > 0 && height > 0;
  return {
    kind,
    seconds:
      milliseconds === undefined || milliseconds <= 0
        ? null
        : Math.max(1, Math.round(milliseconds / 1000)),
    width: sized ? width : null,
    height: sized ? height : null,
  };
}

/**
 * A digest of everything the page is written from, so a page is written again
 * exactly when it would come out differently. Drive does not always report a
 * file modified when only its description changes.
 */
export function mediaChecksum(item: DriveItem): string {
  return sha256(
    JSON.stringify({
      version: MEDIA_VERSION,
      vids: item.mimeType === GOOGLE_VIDS_MIME_TYPE,
      facts: mediaFacts(item),
      description: item.description ?? '',
    }),
  );
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
function factsSentence(facts: GeneratedMediaFacts, vids: boolean): string {
  const what = vids
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
  const where = vids ? 'Google Vids' : 'Google Drive';
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

export interface MediaMarkdown {
  body: string;
  /** The description's first paragraph, the page's summary. */
  description?: string;
  /** Whether Drive holds a description of the recording. */
  described: boolean;
}

/** The page of a recording, from its Drive metadata. */
export function mediaToMarkdown(item: DriveItem): MediaMarkdown {
  const facts = mediaFacts(item);
  const paragraphs = descriptionParagraphs(item.description);
  const tree: Root = {
    type: 'root',
    children: [
      factsSentence(facts, item.mimeType === GOOGLE_VIDS_MIME_TYPE),
      ...paragraphs,
    ].map((value): Paragraph => ({
      type: 'paragraph',
      children: [{ type: 'text', value }],
    })),
  };
  const [first] = paragraphs;
  return {
    // One final newline, as every generated body ends.
    body: `${markdownProcessor.stringify(tree).trimEnd()}\n`,
    ...(first ? { description: truncateDescription(first) } : {}),
    described: first !== undefined,
  };
}

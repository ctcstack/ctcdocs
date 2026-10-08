/**
 * What is in the published folders but not on the site, and why (ADR-025).
 *
 * The sync used to count what it left behind and name none of it. A file an
 * editor put in a published folder then simply never appeared, and nothing
 * said so. This module lists every such file with the reason and with what to
 * do about it, worded for the person who can act, the way the content health
 * checks are (ADR-024). The wording lives here, once, and travels in the sync
 * report, so the page, the job summary and the terminal say the same thing.
 * Files the site does not publish are grouped by what an editor would do with
 * them, a Word file apart from an image (ADR-028).
 *
 * The list is a pure function of the inventory and the run's export failures:
 * an unchanged Drive rewrites it byte for byte.
 */
import type {
  InventorySelection,
  SelectedInventoryItem,
} from '../inventory/inventory-graph.js';
import type { SyncedDocumentRecord } from '../manifest.js';
import { parseOrderedLabel } from '../ordered-label.js';

/**
 * - `not-published`: nothing of the file is on the site.
 * - `out-of-date`: the site shows an earlier version, which it keeps until the
 *   current one can be published.
 * - `incomplete`: the file has a page, but part of it is missing: a PDF too
 *   large to serve, or one whose text cannot be read (ADR-027); a spreadsheet
 *   cut short, or one with charts or images the page does not show (ADR-046).
 */
export type UnpublishedStatus = 'not-published' | 'out-of-date' | 'incomplete';

export type UnpublishedReasonCode =
  | 'name-script'
  | 'export-too-large'
  | 'download-restricted'
  | 'content-rejected'
  | 'readers-widened'
  | 'pdf-no-text'
  | 'pdf-over-site-limit'
  | 'pdf-too-large'
  | 'sheet-truncated'
  | 'sheet-not-shown'
  | 'word-file'
  | 'presentation-file'
  | 'archive-file'
  | 'image-file'
  | 'diagram-file'
  | 'spreadsheet-file'
  | 'unsupported-type'
  /** Retired by ADR-047: video and audio files have pages. */
  | 'media-file'
  | 'shortcut';

/** Reasons an earlier version wrote that no file is given any longer. */
export const RETIRED_REASON_CODES: readonly UnpublishedReasonCode[] = [
  'media-file',
];

export interface UnpublishedReason {
  code: UnpublishedReasonCode;
  /** What the group is, as a heading and a table row say it. */
  title: string;
  /** What to do, short enough for a table cell. */
  action: string;
  /** What to do, in full, for the person who can do it. */
  instruction: string;
}

export const UNPUBLISHED_STATUS_LABELS: Readonly<
  Record<UnpublishedStatus, string>
> = {
  'not-published': 'Not on the site',
  'out-of-date': 'Out of date on the site',
  incomplete: 'Incomplete on the site',
};

/**
 * In the order the page shows them: what stops a document first, then what is
 * missing from a page, then kinds of file by how much there is to gain from
 * them (ADR-028).
 */
export const UNPUBLISHED_REASONS: readonly UnpublishedReason[] = [
  {
    code: 'name-script',
    title: 'The name uses letters from another alphabet',
    action: 'Retype the letters named',
    instruction:
      "A file's name becomes its address on the site, and the site writes its addresses in one alphabet. Retype the letters named below in Drive, or rename the file.",
  },
  {
    code: 'export-too-large',
    title: 'Google cannot export the document: it is over 10 MB',
    action: 'Shrink images or split it',
    instruction:
      'Google refuses to export a document larger than 10 MB, and large images are the usual cause. Compress or crop the images, or split the document in two.',
  },
  {
    code: 'download-restricted',
    title: 'Downloading is turned off for the file',
    action: 'Allow downloading',
    instruction:
      'The owner turned off downloading, printing and copying for viewers, so the sync cannot read the file. Turn it back on under Share → Settings, or ask the owner to.',
  },
  {
    code: 'content-rejected',
    title: 'The document holds something the site will not publish',
    action: 'Remove the part named',
    instruction:
      'Conversion stopped on content it cannot publish safely, named under the document. Remove or replace that part of the document.',
  },
  {
    code: 'readers-widened',
    title: 'More people would read the document than before',
    action: 'Confirm its readers in an access rule',
    instruction:
      'The document moved in Drive to a folder whose access rules would let more people read it. Until someone who maintains the site adds or changes an access rule on its new folder or a folder above it, it is published only to the readers both folders allow. Ask them to confirm who may read it, or move the document back.',
  },
  {
    code: 'pdf-no-text',
    title: 'Search cannot read the PDF',
    action: 'Replace with a PDF with text',
    instruction:
      'The PDF is on the site, but it has no text the site can read: most likely scanned pages, or a password. Search does not find what it says. Replace it with a PDF that has text: most scanning and PDF tools can recognize it (OCR).',
  },
  {
    code: 'pdf-over-site-limit',
    title: 'The PDF is too large for the site to serve',
    action: 'Save a smaller copy',
    instruction:
      'The site serves files up to 25 MB, so the page shows the text of the PDF and links to it in Drive. To put the file itself on the site, save a smaller copy, with images at a lower resolution, and replace this one.',
  },
  {
    code: 'pdf-too-large',
    title: 'The PDF is too large to read',
    action: 'Save a smaller copy',
    instruction:
      'The site does not download a PDF over 100 MB, so its page only links to Drive and search does not find its text. Save a smaller copy and replace this one.',
  },
  {
    code: 'sheet-truncated',
    title: 'Only part of the spreadsheet is on the site',
    action: 'Split it or hide what is not needed',
    instruction:
      'The site publishes up to 2,000 rows of a sheet, 50,000 filled cells and 100 sheets of a spreadsheet, and its page says where it stops. Split the spreadsheet, or hide the sheets readers do not need: a hidden sheet is not published.',
  },
  {
    code: 'sheet-not-shown',
    title: 'The spreadsheet has charts or images the site does not show',
    action: 'Nothing, or add them to a document',
    instruction:
      'The page shows the cells, and says that the sheet has charts or images readers will find only in the spreadsheet. If a chart matters to readers, copy it into the Google Doc that explains the numbers.',
  },
  {
    code: 'word-file',
    title: 'Word and text files',
    action: 'Save as Google Docs',
    instruction:
      'The site publishes Google Docs, not Word files. Open each one in Drive, choose File → Save as Google Docs, check the result and delete the original. The new document is published on the next sync.',
  },
  {
    code: 'presentation-file',
    title: 'Presentations',
    action: 'Export as PDF',
    instruction:
      'The site publishes PDF files. Download the presentation as a PDF, upload it to the same folder, and move the original out of the published folders.',
  },
  {
    code: 'archive-file',
    title: 'Archives',
    action: 'Unpack and upload the files',
    instruction:
      'The site does not open archives. Unpack it and upload what it holds: Google Docs, PDF files, spreadsheets, video and audio are published, and anything else is listed here with its own advice. Then delete the archive.',
  },
  {
    code: 'image-file',
    title: 'Images',
    action: 'Insert into a document',
    instruction:
      'An image on its own has no page to show it. Insert it into the Google Doc it belongs to, then move the file out of the published folders.',
  },
  {
    code: 'diagram-file',
    title: 'Diagrams',
    action: 'Export as PDF or image',
    instruction:
      'The site cannot draw diagram files. Export the diagram as a PDF, or as an image inserted into the document it explains.',
  },
  {
    code: 'spreadsheet-file',
    title: 'Spreadsheets in an older format',
    action: 'Save as Google Sheets',
    instruction:
      'The site publishes Google Sheets, Excel workbooks (.xlsx) and CSV files, not .xls or OpenDocument spreadsheets. Open each one in Drive, choose File → Save as Google Sheets, check the result and delete the original. The new spreadsheet is published on the next sync.',
  },
  {
    code: 'unsupported-type',
    title: 'Other files the site does not publish',
    action: 'Convert, link or move out',
    instruction:
      'The site publishes Google Docs, PDF files, spreadsheets, video and audio. If this content belongs on the site, save it as one of those. Otherwise link to it from a document, or move it out of the published folders.',
  },
  {
    code: 'shortcut',
    title: 'Shortcuts',
    action: 'Move the original here',
    instruction:
      'A shortcut points to a file kept somewhere else, and the sync does not follow it. Move the original into this folder, or link to it from a document instead.',
  },
];

const WORD_TYPES = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.oasis.opendocument.text',
  'application/rtf',
  'text/rtf',
  'text/plain',
  'text/markdown',
]);
const PRESENTATION_TYPES = new Set([
  'application/vnd.google-apps.presentation',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.presentation',
  'application/vnd.apple.keynote',
]);
const SPREADSHEET_TYPES = new Set([
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.spreadsheet',
  'text/csv',
  'text/tab-separated-values',
]);
const ARCHIVE_TYPES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/x-7z-compressed',
  'application/vnd.rar',
  'application/x-rar-compressed',
  'application/x-tar',
  'application/gzip',
]);
const DIAGRAM_TYPES = new Set([
  'application/vnd.google-apps.drawing',
  'application/vnd.jgraph.mxfile',
  'application/vnd.visio',
  'application/vnd.ms-visio.drawing.main+xml',
]);
const DIAGRAM_EXTENSIONS = /\.(?:drawio|dio|vsdx?)$/iu;

/**
 * The group a file the site does not publish belongs to: what an editor would
 * do with it. The name decides where Drive does not know the type, as with a
 * draw.io file, which Drive stores as bytes.
 */
export function unsupportedFileReason(
  mimeType: string,
  name: string,
): UnpublishedReasonCode {
  if (DIAGRAM_TYPES.has(mimeType) || DIAGRAM_EXTENSIONS.test(name)) {
    return 'diagram-file';
  }
  if (WORD_TYPES.has(mimeType)) {
    return 'word-file';
  }
  if (PRESENTATION_TYPES.has(mimeType)) {
    return 'presentation-file';
  }
  if (SPREADSHEET_TYPES.has(mimeType)) {
    return 'spreadsheet-file';
  }
  if (ARCHIVE_TYPES.has(mimeType)) {
    return 'archive-file';
  }
  if (mimeType.startsWith('image/')) {
    return 'image-file';
  }
  return 'unsupported-type';
}

export interface UnpublishedItem {
  id: string;
  /** The Drive name, as an editor typed it. */
  name: string;
  /** Display labels of the folders above the file. */
  folderPath: string[];
  /** What kind of file it is, in words: `Google Sheets`, `Image (PNG)`. */
  type: string;
  mimeType: string;
  status: UnpublishedStatus;
  reason: UnpublishedReasonCode;
  /** What exactly stopped it, when the reason alone does not say. */
  detail?: string;
  /** Opens the file in Google Drive. */
  sourceUrl: string;
  /** Display name of whoever last edited the file in Drive. */
  lastEditedBy: string | null;
  /** For a document out of date: its address on the site. */
  slug?: string;
  /** For a document out of date: when the version on the site was edited. */
  publishedVersion?: string;
}

/** A folder the configuration keeps off the site, with what is in it. */
export interface IgnoredFolder {
  id: string;
  name: string;
  folderPath: string[];
  /** Files and folders below it, at any depth. */
  items: number;
}

/** A document the run could not publish, and what the run did instead. */
export interface HeldDocument {
  reason: UnpublishedReasonCode;
  detail?: string;
}

/** A published document with part of it missing, and the record behind it. */
export interface IncompleteDocument {
  reason: UnpublishedReasonCode;
  detail?: string;
  record: SyncedDocumentRecord;
}

const GOOGLE_TYPES: Readonly<Record<string, string>> = {
  'application/vnd.google-apps.document': 'Google Docs',
  'application/vnd.google-apps.spreadsheet': 'Google Sheets',
  'application/vnd.google-apps.presentation': 'Google Slides',
  'application/vnd.google-apps.form': 'Google Forms',
  'application/vnd.google-apps.drawing': 'Google Drawings',
  'application/vnd.google-apps.jam': 'Google Jamboard',
  'application/vnd.google-apps.map': 'Google My Maps',
  'application/vnd.google-apps.site': 'Google Sites',
  'application/vnd.google-apps.script': 'Apps Script',
  'application/vnd.google-apps.vid': 'Google Vids',
  'application/vnd.google-apps.folder': 'Folder',
};

const FILE_TYPES: Readonly<Record<string, string>> = {
  'application/pdf': 'PDF',
  'application/msword': 'Word document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'Word document',
  'application/vnd.ms-excel': 'Excel 97–2003 workbook',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    'Excel workbook',
  'application/vnd.ms-powerpoint': 'PowerPoint presentation',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    'PowerPoint presentation',
  'application/vnd.oasis.opendocument.text': 'OpenDocument text',
  'application/rtf': 'Rich text',
  'text/plain': 'Text file',
  'text/markdown': 'Markdown file',
  'text/csv': 'CSV file',
  'text/html': 'HTML file',
  'application/json': 'JSON file',
  'application/zip': 'ZIP archive',
};

const GOOGLE_SHORTCUT_MIME_TYPE = 'application/vnd.google-apps.shortcut';

/** A MIME type in words, for a reader who does not know MIME types. */
export function describeFileType(
  mimeType: string,
  shortcutTargetMimeType?: string,
): string {
  if (mimeType === GOOGLE_SHORTCUT_MIME_TYPE) {
    return shortcutTargetMimeType
      ? `Shortcut to ${describeFileType(shortcutTargetMimeType)}`
      : 'Shortcut';
  }
  const known = GOOGLE_TYPES[mimeType] ?? FILE_TYPES[mimeType];
  if (known) {
    return known;
  }
  const [family, subtype = ''] = mimeType.split('/');
  const format = subtype
    .replace(/^(?:x-|vnd\.)/u, '')
    .split(/[.+;]/u)[0]
    ?.toLocaleUpperCase('en');
  switch (family) {
    case 'image':
      return format ? `Image (${format})` : 'Image';
    case 'video':
      return format ? `Video (${format})` : 'Video';
    case 'audio':
      return format ? `Audio (${format})` : 'Audio';
    default:
      return mimeType;
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function folderLabels(selected: SelectedInventoryItem): string[] {
  return selected.path
    .slice(1, -1)
    .map((segment) => parseOrderedLabel(segment).label);
}

/**
 * Opens the item in Drive. Drive's own link names the account that owns the
 * file and how the link was made; neither belongs in a report, so both go.
 */
export function driveUrl(selected: SelectedInventoryItem): string {
  const link = selected.item.webViewLink;
  if (!link) {
    return `https://drive.google.com/open?id=${encodeURIComponent(selected.item.id)}`;
  }
  const url = new URL(link);
  url.searchParams.delete('ouid');
  url.searchParams.delete('usp');
  return url.toString();
}

/** Keys in the order the report schema lists them, for stable bytes. */
function entryFor(
  selected: SelectedInventoryItem,
  status: UnpublishedStatus,
  reason: UnpublishedReasonCode,
  detail?: string,
  published?: SyncedDocumentRecord,
): UnpublishedItem {
  const { item } = selected;
  return {
    id: item.id,
    name: item.name,
    folderPath: folderLabels(selected),
    type: describeFileType(item.mimeType, item.shortcutDetails?.targetMimeType),
    mimeType: item.mimeType,
    status,
    reason,
    ...(detail ? { detail } : {}),
    sourceUrl: driveUrl(selected),
    lastEditedBy: item.lastModifyingUser?.displayName ?? null,
    ...(published
      ? {
          slug: published.stableSlug,
          publishedVersion: published.googleModifiedTime,
        }
      : {}),
  };
}

/**
 * Everything under the publication root that the site does not show as it is
 * in Drive now.
 *
 * `selection` is the inventory as Drive reports it, before the run held any
 * document back. `kept` holds the documents whose previous version stays on
 * the site, with the record of that version.
 */
export function createUnpublishedItems(
  selection: InventorySelection,
  held: ReadonlyMap<string, HeldDocument>,
  kept: ReadonlyMap<string, SyncedDocumentRecord>,
  incomplete: ReadonlyMap<string, readonly IncompleteDocument[]> = new Map(),
): UnpublishedItem[] {
  const items: UnpublishedItem[] = selection.unsupported.map((selected) =>
    entryFor(
      selected,
      'not-published',
      selected.item.mimeType === GOOGLE_SHORTCUT_MIME_TYPE
        ? 'shortcut'
        : unsupportedFileReason(selected.item.mimeType, selected.item.name),
    ),
  );
  for (const selected of selection.documents) {
    const failure = held.get(selected.item.id);
    if (!failure) {
      continue;
    }
    const record = kept.get(selected.item.id);
    items.push(
      entryFor(
        selected,
        record ? 'out-of-date' : 'not-published',
        failure.reason,
        failure.detail,
        record,
      ),
    );
  }
  for (const selected of selection.documents) {
    if (held.has(selected.item.id)) {
      continue;
    }
    for (const missing of incomplete.get(selected.item.id) ?? []) {
      items.push(
        entryFor(
          selected,
          'incomplete',
          missing.reason,
          missing.detail,
          missing.record,
        ),
      );
    }
  }
  const reasonOrder = new Map(
    UNPUBLISHED_REASONS.map((reason, index) => [reason.code, index]),
  );
  return items.sort(
    (left, right) =>
      compareText(left.folderPath.join('/'), right.folderPath.join('/')) ||
      compareText(left.name, right.name) ||
      compareText(left.id, right.id) ||
      (reasonOrder.get(left.reason) ?? 0) -
        (reasonOrder.get(right.reason) ?? 0),
  );
}

export function createIgnoredFolders(
  selection: InventorySelection,
): IgnoredFolder[] {
  return selection.ignoredFolders
    .map((folder) => ({
      id: folder.item.id,
      name: folder.item.name,
      folderPath: folderLabels(folder),
      items: folder.itemCount,
    }))
    .sort(
      (left, right) =>
        compareText(left.folderPath.join('/'), right.folderPath.join('/')) ||
        compareText(left.name, right.name) ||
        compareText(left.id, right.id),
    );
}

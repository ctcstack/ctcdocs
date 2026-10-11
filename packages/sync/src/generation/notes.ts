/**
 * What a reader or an editor should know about a published page, though it is
 * on the site (ADR-028).
 *
 * Conversion changes some documents on the way: a link with an address the
 * site will not publish is dropped, a merged cell that cannot be read is split.
 * Drive's structure can surprise too: two files in one folder with the same
 * name become two pages called the same, and two items with one order number
 * leave their order to chance. The pipeline knew all of this and recorded it as
 * codes in the manifest or counted it in a log. Here each becomes a note with
 * the document it concerns and what to do, in a catalog like the reasons a file
 * is not on the site (ADR-025).
 *
 * Routine differences are not notes: a document that goes through the HTML
 * export for its images, or loses the inline styles the site replaces with
 * its own, reads the same on the site.
 */
import { documentName } from '../google/drive-types.js';
import type {
  InventoryIssue,
  InventorySelection,
  SelectedInventoryItem,
} from '../inventory/inventory-graph.js';
import {
  documentFormat,
  isGoogleDocRecord,
  isMediaRecord,
  type SyncedDocumentRecord,
  type SyncManifest,
} from '../manifest.js';
import { plural } from '../plural.js';
import { slugifySegment } from '../slug.js';
import type { NearDuplicate } from './near-duplicates.js';
import { describeFileType, driveUrl, folderLabels } from './unpublished.js';

export type NoteCode =
  | 'duplicate-name'
  | 'duplicate-order'
  | 'several-landing-documents'
  | 'unread-order-number'
  | 'ignored-folder-missing'
  | 'image-removed'
  | 'image-crop-not-applied'
  | 'link-removed'
  | 'heading-link-shortened'
  | 'link-outside-site'
  | 'table-merge-removed'
  | 'formatting-removed'
  | 'code-block-unclosed'
  | 'pdf-text-truncated'
  | 'document-over-agent-limit'
  | 'document-long'
  | 'pdf-long'
  | 'sheet-long'
  | 'image-undescribed'
  | 'image-large'
  | 'summary-missing'
  | 'media-undescribed'
  | 'document-near-duplicate'
  | 'document-stale';

export interface NoteKind {
  code: NoteCode;
  title: string;
  /** What to do, short enough for a table cell. */
  action: string;
  instruction: string;
}

/** In the order the page shows them: what readers notice first. */
export const NOTE_KINDS: readonly NoteKind[] = [
  {
    code: 'image-crop-not-applied',
    title: 'A cropped image is shown whole',
    action: 'Check what was cropped away',
    instruction:
      'The image is cropped in Google Docs in a way the site cannot repeat: it is not a PNG, it is also rotated, or its frame cannot be read. So the site shows it as it was inserted, the part cropped away included, to readers and to AI agents. Check that nothing in that part should stay out of the documentation. To show only what you kept, crop the image before inserting it, or insert it as a PNG.',
  },
  {
    code: 'duplicate-name',
    title: 'Files in one folder share a name',
    action: 'Rename one, or remove it',
    instruction:
      'Readers see two pages called the same, and the second has an address with a code on the end. If both belong on the site, rename one so they can be told apart; if one is a copy, such as a PDF exported from the document, move it out of the published folders.',
  },
  {
    code: 'image-removed',
    title: 'An image was left out',
    action: 'Insert the image again',
    instruction:
      'The export of the document named an image the sync could not find, so the page shows the text without it. Insert the image again in Google Docs.',
  },
  {
    code: 'link-removed',
    title: 'A link was removed',
    action: 'Fix the link',
    instruction:
      'A link pointed to an address the site does not publish, such as a local file or a script, so its text is on the page without the link. Point it to a web page, a Google Drive file or an email address.',
  },
  {
    code: 'heading-link-shortened',
    title: 'A link to a heading opens the top of the page',
    action: 'Nothing, or link the page',
    instruction:
      'A link pointed to a heading inside another document. The site links to that document, but not to the heading, so a reader lands at the top of the page.',
  },
  {
    code: 'link-outside-site',
    title: 'A link leads to a Google file that is not on this site',
    action: 'Publish the file, or link a page',
    instruction:
      'A link points to a Google Doc or a Drive file outside the published folders. A colleague with access in Drive can open it, but the site cannot show it, and an AI agent reading the site cannot follow it. If the file belongs in the documentation, move it into the published folders; otherwise link to a page of this site where one covers it. Links to spreadsheets, slides and folders are not counted, because the site does not publish them, and neither are links whose address does not say what the file is.',
  },
  {
    code: 'table-merge-removed',
    title: 'A merged table cell was split',
    action: 'Check the table',
    instruction:
      'A merged cell in a table spanned a number of rows or columns the site cannot read, so it is shown unmerged. Check that the table still reads right, and merge the cells again in Google Docs if not.',
  },
  {
    code: 'formatting-removed',
    title: 'Formatting the site does not show was removed',
    action: 'Check the page',
    instruction:
      'The document held elements the site does not publish, such as an embedded frame, and they were left out. Check the page, and replace what is missing with a link.',
  },
  {
    code: 'code-block-unclosed',
    title: 'A code block is never closed',
    action: 'Close the code block',
    instruction:
      'A line of three backticks opens a code block and no second one closes it, so everything after it shows as code. Add a line of three backticks where the code ends.',
  },
  {
    code: 'pdf-text-truncated',
    title: 'Only part of the PDF is searchable',
    action: 'Split the PDF',
    instruction:
      'The PDF holds more text than the site indexes, a million characters, so search finds only its first part. The file itself is complete. Split it if all of it should be found.',
  },
  {
    code: 'document-over-agent-limit',
    title: 'AI agents read only the beginning of a document',
    action: 'Split it into shorter documents',
    instruction:
      'The document is longer than an AI agent is given when it reads one, so an agent reads only its beginning and does not know what the rest says. Split it into a folder of shorter documents, one subject each: each part then has its own page, title and search results, and is read whole. Keep the document itself for one of the parts, so that its permanent link, and every link to it from another document, still leads to it.',
  },
  {
    code: 'document-long',
    title: 'A document is long enough to split',
    action: 'Split it into shorter documents',
    instruction:
      'The document is longer than the length this site notes. People scroll past most of it to find their part, and an AI agent reads all of it to answer about one, which costs it and makes its answers worse. Split it into a folder of shorter documents, one subject each: each part then has its own page, title and search results. Keep the document itself for one of the parts, so that its permanent link, and every link to it from another document, still leads to it.',
  },
  {
    code: 'pdf-long',
    title: 'A PDF is long to read whole',
    action: 'Nothing, if it must stay a PDF',
    instruction:
      'The PDF holds more text than the length this site notes. The site publishes a PDF as it is, so this is a note rather than a task: an AI agent reads all of it to answer about one part, and past the length an agent is given at once it reads only the beginning. If the PDF was saved from a Google Doc, publishing the document instead, split into shorter ones, lets people and agents read the part they need.',
  },
  {
    code: 'sheet-long',
    title: 'A spreadsheet is long to read whole',
    action: 'Hide or split what readers do not need',
    instruction:
      'The spreadsheet holds more than the length this site notes, so an AI agent reads all of it to answer about one table, and past the length an agent is given at once it reads only the beginning. Hide the sheets readers do not need, since a hidden sheet is not published, or split the spreadsheet into one per subject.',
  },
  {
    code: 'image-undescribed',
    title: 'An image has no description',
    action: 'Add alt text',
    instruction:
      'The image has no alt text, so people using a screen reader, and AI agents reading the page as text, learn nothing of what it shows. In Google Docs, right-click the image, choose Alt text, and describe it in a sentence.',
  },
  {
    code: 'image-large',
    title: 'An image is larger than this site expects',
    action: 'Use a smaller image',
    instruction:
      'The image file is larger than the size this site notes, so it is slow to open, and an AI agent may be refused it: some AI services take images of a few megabytes at most. Insert a smaller one: a screenshot cropped to what matters before it is inserted, or a photo as JPEG.',
  },
  {
    code: 'summary-missing',
    title: 'The page has no summary',
    action: 'Add an opening sentence',
    instruction:
      "The site takes a page's summary from its first paragraph of plain text. This document has none, only headings, lists or tables, so search results, the section page and the index AI agents read show its title alone. Add a sentence under the title that says what the document is for.",
  },
  {
    code: 'media-undescribed',
    title: 'A recording has no description',
    action: 'Describe it in Drive',
    instruction:
      "The site does not watch or listen to a recording: its page shows the recording's name and the description written in Drive, and that is all search and AI agents know of it. In Drive, right-click the file, choose File information → Details and fill in its description: what it shows, for whom, and the steps or topics in order. Rename it too if its name is what the recorder chose. The page changes on the next sync.",
  },
  {
    code: 'document-near-duplicate',
    title: 'Another document holds the same text',
    action: 'Keep one, link to it',
    instruction:
      'This document and the one named share nearly all their text, or one holds the other whole, though their names differ. As one copy is edited the other goes out of date, and readers and AI agents find both and cannot tell which is right. Keep the text in one document, remove the other or replace its text with a link to the one you keep. If both must stay, make each say what only it covers.',
  },
  {
    code: 'document-stale',
    title: 'A document has not been edited for a long time',
    action: 'Review it, then edit or retire it',
    instruction:
      'Nobody has edited this document in Drive for longer than this site asks: readers and AI agents cannot tell whether it still holds. Read it through. If it is right, make any small edit that keeps it current, such as the date it was reviewed; if it is not, correct it, or move it out of the published folders.',
  },
  {
    code: 'duplicate-order',
    title: 'Two items share an order number',
    action: 'Renumber one',
    instruction:
      'Two items in a folder start with the same number, so their order on the site falls back to their names. Give each its own number in Drive.',
  },
  {
    code: 'several-landing-documents',
    title: 'A folder has more than one landing document',
    action: 'Rename all but one',
    instruction:
      'A folder may hold one document named like its landing page, such as Overview, which the site shows first. This one is another; rename it so the folder opens where it should.',
  },
  {
    code: 'unread-order-number',
    title: 'A number in the name is not read as an order',
    action: 'Write it as "01 - Name"',
    instruction:
      'The name starts with a number, but not in a form the site reads as an order, so the number shows in the title. Write it as "01 - Name" or "[1] Name", or remove it.',
  },
  {
    code: 'ignored-folder-missing',
    title: 'A folder the configuration ignores is not there',
    action: 'Update the configuration',
    instruction:
      'The site is configured to leave out a folder that is no longer in the published folders. Ask whoever maintains the site to remove it from GOOGLE_IGNORED_FOLDER_IDS.',
  },
];

/** What conversion recorded, by the note it is. Routine codes are absent. */
const WARNING_NOTES: Readonly<Record<string, NoteCode>> = {
  removed_unsafe_image: 'image-removed',
  image_crop_not_applied: 'image-crop-not-applied',
  removed_unsafe_link: 'link-removed',
  'link:removed_google_anchor': 'heading-link-shortened',
  'link:outside_site': 'link-outside-site',
  removed_invalid_table_span: 'table-merge-removed',
  removed_unsupported_html: 'formatting-removed',
  unterminated_code_fence: 'code-block-unclosed',
  'pdf:text_truncated': 'pdf-text-truncated',
};

const ISSUE_NOTES: Readonly<Record<string, NoteCode>> = {
  duplicate_navigation_order: 'duplicate-order',
  multiple_landing_documents: 'several-landing-documents',
  unrecognized_order_prefix: 'unread-order-number',
  ignored_not_found: 'ignored-folder-missing',
  ignored_outside_root: 'ignored-folder-missing',
};

/** The sizes of the images each page publishes, and the size to note. */
interface PublishedImageSizes {
  /** From the project configuration: `sync.largeImageMegabytes`. */
  largeImageMegabytes: number;
  /** Bytes of each image file a document publishes, by Google file ID. */
  imageBytes: ReadonlyMap<string, readonly number[]>;
}

/** The length of each page's text, and the two lines to note (ADR-043). */
interface PublishedDocumentLengths {
  /** From the project configuration: `sync.largeDocumentCharacters`. */
  largeDocumentCharacters: number;
  /** The characters an AI agent reads of a document: the cut `fetch` makes. */
  fetchCharacters: number;
  /** Characters of each page's Markdown body, by Google file ID. */
  characters: ReadonlyMap<string, number>;
}

/** What the run published, measured from its output. */
export interface PublishedSizes {
  images?: PublishedImageSizes;
  documents?: PublishedDocumentLengths;
  /** Documents sharing their text, by Google file ID (ADR-049). */
  nearDuplicates?: ReadonlyMap<string, readonly NearDuplicate[]>;
}

/** When a document is old enough to ask for its review (ADR-049). */
export interface ReviewLines {
  /** The run's time. */
  now: Date;
  /** From the project configuration: `sync.staleAfterMonths`; 0 for none. */
  months: number;
  /** Months by Drive folder ID, from `sync.staleFolders`, for what is below. */
  folders: ReadonlyMap<string, number>;
}

export interface ReportNote {
  id: string;
  name: string;
  folderPath: string[];
  type: string;
  sourceUrl: string;
  lastEditedBy: string | null;
  /** The page on the site, when the item has one. */
  slug?: string;
  note: NoteCode;
  detail?: string;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function noteFor(
  selected: SelectedInventoryItem,
  note: NoteCode,
  slug: string | undefined,
  detail?: string,
): ReportNote {
  const { item } = selected;
  return {
    id: item.id,
    name: item.name,
    folderPath: folderLabels(selected),
    type: describeFileType(item.mimeType),
    sourceUrl: driveUrl(selected),
    lastEditedBy: item.lastModifyingUser?.displayName ?? null,
    ...(slug ? { slug } : {}),
    note,
    ...(detail ? { detail } : {}),
  };
}

const quoted = (name: string) => `“${name}”`;

/** One decimal, the way a file size reads: `4.3 MB`. */
const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

/** Thousands apart, the way a count reads: `52,341`. */
const grouped = (count: number) =>
  String(count).replace(/\B(?=(\d{3})+$)/gu, ',');

function largeImages(
  bytes: readonly number[],
  images: PublishedImageSizes,
): string | undefined {
  const over = bytes
    .filter((size) => size > images.largeImageMegabytes * 1_000_000)
    .sort((left, right) => right - left);
  const [largest] = over;
  if (largest === undefined) {
    return undefined;
  }
  const limit = `${images.largeImageMegabytes} MB`;
  return over.length === 1
    ? `1 image over ${limit}: ${megabytes(largest)}`
    : `${plural(over.length, 'image')} over ${limit}, the largest ${megabytes(largest)}`;
}

/**
 * A page longer than an AI agent reads, or than the line, gets one note: the
 * first that applies. A PDF's editor usually cannot split it, so its note
 * says how long it is and whether agents read it whole, and asks nothing; a
 * spreadsheet's says what its editor can do instead of splitting a document.
 */
function longDocument(
  record: SyncedDocumentRecord,
  lengths: PublishedDocumentLengths,
): { code: NoteCode; detail: string } | undefined {
  const characters = lengths.characters.get(record.googleFileId) ?? 0;
  const format = documentFormat(record);
  const pdf = format === 'pdf';
  const sheet = format === 'sheet';
  if (characters > lengths.fetchCharacters) {
    return {
      code: pdf
        ? 'pdf-long'
        : sheet
          ? 'sheet-long'
          : 'document-over-agent-limit',
      detail: `${grouped(characters)} characters; AI agents read the first ${grouped(lengths.fetchCharacters)}`,
    };
  }
  if (characters > lengths.largeDocumentCharacters) {
    return {
      code: pdf ? 'pdf-long' : sheet ? 'sheet-long' : 'document-long',
      detail: `${grouped(characters)} characters, over ${grouped(lengths.largeDocumentCharacters)}`,
    };
  }
  return undefined;
}

/**
 * The notes for the corpus as it is published: `selection` is the inventory
 * the run published from, `manifest` what it published, and `sizes` the
 * sizes of the image files and the lengths of the pages it published.
 */
export function createNotes(
  selection: InventorySelection,
  manifest: SyncManifest,
  sizes: PublishedSizes = {},
  review?: ReviewLines,
): ReportNote[] {
  const { images, documents, nearDuplicates } = sizes;
  const itemsById = new Map<string, SelectedInventoryItem>(
    [...selection.folders, ...selection.documents].map((selected) => [
      selected.item.id,
      selected,
    ]),
  );
  const slugOf = (id: string) =>
    manifest.documents[id]?.stableSlug ?? manifest.folders[id]?.stableSlug;
  const notes: ReportNote[] = [];

  for (const record of Object.values(manifest.documents)) {
    const selected = itemsById.get(record.googleFileId);
    if (!selected) {
      continue;
    }
    const codes = new Set(
      record.warnings.flatMap((warning) => {
        const note = WARNING_NOTES[warning];
        return note ? [note] : [];
      }),
    );
    for (const code of codes) {
      notes.push(noteFor(selected, code, record.stableSlug));
    }
    const undescribed = record.undescribedImages ?? 0;
    if (undescribed > 0) {
      notes.push(
        noteFor(
          selected,
          'image-undescribed',
          record.stableSlug,
          plural(undescribed, 'image'),
        ),
      );
    }
    const large = images
      ? largeImages(images.imageBytes.get(record.googleFileId) ?? [], images)
      : undefined;
    if (large) {
      notes.push(noteFor(selected, 'image-large', record.stableSlug, large));
    }
    const long = documents ? longDocument(record, documents) : undefined;
    if (long) {
      notes.push(noteFor(selected, long.code, record.stableSlug, long.detail));
    }
    /*
     * A PDF's summary is its extracted text and a spreadsheet's is written
     * from its sheets, neither of which an editor can write.
     */
    if (isGoogleDocRecord(record) && !record.description) {
      notes.push(noteFor(selected, 'summary-missing', record.stableSlug));
    }
    // A recording's summary is the description its editor writes in Drive.
    if (isMediaRecord(record) && !record.description) {
      notes.push(noteFor(selected, 'media-undescribed', record.stableSlug));
    }
    const duplicates = nearDuplicates?.get(record.googleFileId);
    if (duplicates && duplicates.length > 0) {
      notes.push(
        noteFor(
          selected,
          'document-near-duplicate',
          record.stableSlug,
          nearDuplicateDetail(duplicates, itemsById, manifest),
        ),
      );
    }
    const stale = review
      ? staleDetail(record, selected, review, itemsById)
      : undefined;
    if (stale) {
      notes.push(noteFor(selected, 'document-stale', record.stableSlug, stale));
    }
  }

  /*
   * Two names the site cannot tell apart are one page title and one address,
   * whatever their case, punctuation or `.pdf` says.
   */
  const byFolderAndName = new Map<string, SelectedInventoryItem[]>();
  for (const selected of selection.documents) {
    if (!manifest.documents[selected.item.id]) {
      continue;
    }
    const key = `${selected.parentId ?? ''}/${slugifySegment(documentName(selected.item))}`;
    byFolderAndName.set(key, [...(byFolderAndName.get(key) ?? []), selected]);
  }
  for (const group of byFolderAndName.values()) {
    if (group.length < 2) {
      continue;
    }
    for (const selected of group) {
      const others = group
        .filter((other) => other !== selected)
        .map(
          (other) =>
            `${quoted(other.item.name)} (${describeFileType(other.item.mimeType)})`,
        )
        .join(', ');
      notes.push(
        noteFor(
          selected,
          'duplicate-name',
          slugOf(selected.item.id),
          `Also in this folder: ${others}`,
        ),
      );
    }
  }

  for (const issue of selection.warnings) {
    const code = ISSUE_NOTES[issue.code];
    if (!code) {
      continue;
    }
    notes.push(issueNote(issue, code, itemsById, slugOf));
  }

  return notes.sort(
    (left, right) =>
      compareText(left.note, right.note) ||
      compareText(left.folderPath.join('/'), right.folderPath.join('/')) ||
      compareText(left.name, right.name) ||
      compareText(left.id, right.id),
  );
}

/** The names of a document's near duplicates and how each relates to it. */
function nearDuplicateDetail(
  duplicates: readonly NearDuplicate[],
  itemsById: ReadonlyMap<string, SelectedInventoryItem>,
  manifest: SyncManifest,
): string {
  const NAMED = 3;
  const named = duplicates.slice(0, NAMED).map((duplicate) => {
    // A targeted run selects one file; the manifest still names the rest.
    const name = quoted(
      itemsById.get(duplicate.id)?.item.name ??
        manifest.documents[duplicate.id]?.googleName ??
        duplicate.id,
    );
    return duplicate.relation === 'inside'
      ? `Its text is also in ${name}`
      : duplicate.relation === 'holds'
        ? `Holds the text of ${name}`
        : `Nearly the same text as ${name} (${duplicate.similarPercent}% shared)`;
  });
  const more = duplicates.length - named.length;
  return more > 0
    ? `${named.join('; ')}; and ${plural(more, 'other document')}`
    : named.join('; ');
}

/**
 * The line a document is held to: that of the nearest folder above it with
 * one of its own, else the project's.
 */
function reviewMonths(
  selected: SelectedInventoryItem,
  review: ReviewLines,
  itemsById: ReadonlyMap<string, SelectedInventoryItem>,
): number {
  const seen = new Set<string>();
  let folderId = selected.parentId;
  while (folderId !== null && !seen.has(folderId)) {
    seen.add(folderId);
    const months = review.folders.get(folderId);
    if (months !== undefined) {
      return months;
    }
    folderId = itemsById.get(folderId)?.parentId ?? null;
  }
  return review.months;
}

/**
 * The same time `months` calendar months before `now`, in UTC, on the last day
 * of that month when it is shorter: a month before 30 March is 28 February,
 * not 2 March.
 */
function monthsBefore(now: Date, months: number): Date {
  const total = now.getUTCFullYear() * 12 + now.getUTCMonth() - months;
  const year = Math.floor(total / 12);
  const month = total - year * 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(now.getUTCDate(), lastDay),
      now.getUTCHours(),
      now.getUTCMinutes(),
      now.getUTCSeconds(),
      now.getUTCMilliseconds(),
    ),
  );
}

/**
 * When a document was last edited, if that is longer ago than its line. The
 * date, not an age, so the note reads the same on every run until an edit.
 */
function staleDetail(
  record: SyncedDocumentRecord,
  selected: SelectedInventoryItem,
  review: ReviewLines,
  itemsById: ReadonlyMap<string, SelectedInventoryItem>,
): string | undefined {
  const months = reviewMonths(selected, review, itemsById);
  if (months === 0) {
    return undefined;
  }
  const edited = new Date(record.googleModifiedTime);
  if (edited >= monthsBefore(review.now, months)) {
    return undefined;
  }
  return `Last edited ${edited.toISOString().slice(0, 10)}; this site asks for a review after ${plural(months, 'month')}`;
}

function issueNote(
  issue: InventoryIssue,
  code: NoteCode,
  itemsById: ReadonlyMap<string, SelectedInventoryItem>,
  slugOf: (id: string) => string | undefined,
): ReportNote {
  const selected = itemsById.get(issue.itemId);
  const related = issue.relatedId ? itemsById.get(issue.relatedId) : undefined;
  const detail = related
    ? code === 'duplicate-order'
      ? `Same number as ${quoted(related.item.name)}`
      : `Also a landing document: ${quoted(related.item.name)}`
    : undefined;
  if (selected) {
    return noteFor(selected, code, slugOf(issue.itemId), detail);
  }
  // A configured folder the inventory does not hold: all there is is its ID.
  return {
    id: issue.itemId,
    name: issue.itemId,
    folderPath: [],
    type: 'Folder',
    sourceUrl: `https://drive.google.com/drive/folders/${encodeURIComponent(issue.itemId)}`,
    lastEditedBy: null,
    note: code,
  };
}

import { z } from 'zod';

import { NOTE_KINDS, type NoteCode } from './notes.js';
import {
  UNPUBLISHED_REASONS,
  type HeldDocument,
  type UnpublishedReasonCode,
} from './unpublished.js';

const reasonCodes = UNPUBLISHED_REASONS.map((reason) => reason.code) as [
  UnpublishedReasonCode,
  ...UnpublishedReasonCode[],
];
const noteCodes = NOTE_KINDS.map((kind) => kind.code) as [
  NoteCode,
  ...NoteCode[],
];

const catalogEntry = <TCode extends [string, ...string[]]>(codes: TCode) =>
  z.object({
    code: z.enum(codes),
    title: z.string(),
    action: z.string(),
    instruction: z.string(),
  });

export const syncReportSchema = z.object({
  schemaVersion: z.literal(3),
  generatedAt: z.iso.datetime(),
  dryRun: z.boolean(),
  summary: z.object({
    /** Documents fetched from Google and converted by the run. */
    exported: z.number().int().nonnegative(),
    /** Pages the run added, changed, left as they were and removed. */
    added: z.number().int().nonnegative(),
    changed: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
    folders: z.number().int().nonnegative(),
    unsupported: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
    /** Files in the published folders that are not on the site. */
    notPublished: z.number().int().nonnegative(),
    /** Documents whose earlier version stays on the site. */
    outOfDate: z.number().int().nonnegative(),
    /** Entries for pages with part of their file missing, such as a PDF. */
    incomplete: z.number().int().nonnegative(),
    /** Items below the folders the configuration ignores. */
    ignored: z.number().int().nonnegative(),
    /** Pages on the site, by what they publish. */
    published: z.object({
      googleDocs: z.number().int().nonnegative(),
      pdfs: z.number().int().nonnegative(),
    }),
    /** How the Google Docs on the site were converted. */
    conversion: z.object({
      markdown: z.number().int().nonnegative(),
      html: z.number().int().nonnegative(),
    }),
    /** Entries in `notes`. */
    notes: z.number().int().nonnegative(),
  }),
  /** The reasons behind `unpublished`, in the order the page shows them. */
  reasons: z.array(catalogEntry(reasonCodes)),
  unpublished: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string(),
      folderPath: z.array(z.string()),
      type: z.string().min(1),
      mimeType: z.string().min(1),
      status: z.enum(['not-published', 'out-of-date', 'incomplete']),
      reason: z.enum(reasonCodes),
      detail: z.string().min(1).optional(),
      sourceUrl: z.url(),
      lastEditedBy: z.string().nullable(),
      slug: z.string().min(1).optional(),
      publishedVersion: z.iso.datetime().optional(),
    }),
  ),
  ignoredFolders: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string(),
      folderPath: z.array(z.string()),
      items: z.number().int().nonnegative(),
    }),
  ),
  /** The kinds behind `notes`, in the order the page shows them (ADR-028). */
  noteKinds: z.array(catalogEntry(noteCodes)),
  notes: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string(),
      folderPath: z.array(z.string()),
      type: z.string().min(1),
      sourceUrl: z.url(),
      lastEditedBy: z.string().nullable(),
      slug: z.string().min(1).optional(),
      note: z.enum(noteCodes),
      detail: z.string().min(1).optional(),
    }),
  ),
});

export type SyncReport = z.infer<typeof syncReportSchema>;

export function serializeSyncReport(report: SyncReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/**
 * Whether a report already on disk says the same about what is missing from
 * the site. The counts of a run are not compared: an unchanged corpus keeps the
 * report it has, so a run that only re-exported writes no diff, while a file
 * that appears in or leaves the list is always recorded.
 */
export function reportsListTheSameItems(
  existing: string | undefined,
  report: SyncReport,
): boolean {
  if (existing === undefined) {
    return false;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(existing);
  } catch {
    return false;
  }
  if (!syncReportSchema.safeParse(parsed).success) {
    return false;
  }
  // As recorded, not as parsed: the schema would reorder the keys.
  const previous = parsed as SyncReport;
  return (
    JSON.stringify([
      previous.reasons,
      previous.unpublished,
      previous.ignoredFolders,
      previous.noteKinds,
      previous.notes,
    ]) ===
    JSON.stringify([
      report.reasons,
      report.unpublished,
      report.ignoredFolders,
      report.noteKinds,
      report.notes,
    ])
  );
}

/** Reasons a document is held back by a run, rather than found in Drive. */
const EXPORT_FAILURES: ReadonlySet<UnpublishedReasonCode> = new Set([
  'export-too-large',
  'download-restricted',
  'content-rejected',
]);

/**
 * The documents an earlier run held back, as it recorded them. A targeted run
 * exports one document and cannot know whether the others would still fail,
 * so it carries these forward instead of dropping them from the list.
 */
export function recordedHeldDocuments(
  existing: string | undefined,
): Map<string, HeldDocument & { outOfDate: boolean }> {
  const recorded = new Map<string, HeldDocument & { outOfDate: boolean }>();
  if (existing === undefined) {
    return recorded;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(existing);
  } catch {
    return recorded;
  }
  /*
   * Only the list this reads is checked: a report an earlier version wrote
   * may name a note kind since retired, which says nothing about what it held
   * back.
   */
  const report = syncReportSchema
    .pick({ schemaVersion: true, unpublished: true })
    .safeParse(parsed);
  if (!report.success) {
    return recorded;
  }
  for (const item of report.data.unpublished) {
    if (EXPORT_FAILURES.has(item.reason)) {
      recorded.set(item.id, {
        reason: item.reason,
        ...(item.detail ? { detail: item.detail } : {}),
        outOfDate: item.status === 'out-of-date',
      });
    }
  }
  return recorded;
}

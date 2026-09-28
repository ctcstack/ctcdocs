import { z } from 'zod';

import {
  UNPUBLISHED_REASONS,
  type HeldDocument,
  type UnpublishedReasonCode,
} from './unpublished.js';

const reasonCodes = UNPUBLISHED_REASONS.map((reason) => reason.code) as [
  UnpublishedReasonCode,
  ...UnpublishedReasonCode[],
];

export const syncReportSchema = z.object({
  schemaVersion: z.literal(2),
  generatedAt: z.iso.datetime(),
  dryRun: z.boolean(),
  summary: z.object({
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
  }),
  /** The reasons behind `unpublished`, in the order the page shows them. */
  reasons: z.array(
    z.object({
      code: z.enum(reasonCodes),
      title: z.string(),
      instruction: z.string(),
    }),
  ),
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
    ]) ===
    JSON.stringify([report.reasons, report.unpublished, report.ignoredFolders])
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
  const report = syncReportSchema.safeParse(parsed);
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

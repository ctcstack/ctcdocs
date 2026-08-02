import { z } from 'zod';

export const syncReportSchema = z.object({
  schemaVersion: z.literal(1),
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
  }),
});

export type SyncReport = z.infer<typeof syncReportSchema>;

export function serializeSyncReport(report: SyncReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

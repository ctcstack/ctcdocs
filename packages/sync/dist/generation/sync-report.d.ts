import { z } from 'zod';
export declare const syncReportSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    generatedAt: z.ZodISODateTime;
    dryRun: z.ZodBoolean;
    summary: z.ZodObject<{
        added: z.ZodNumber;
        changed: z.ZodNumber;
        unchanged: z.ZodNumber;
        removed: z.ZodNumber;
        folders: z.ZodNumber;
        unsupported: z.ZodNumber;
        warnings: z.ZodNumber;
    }, z.core.$strip>;
}, z.core.$strip>;
export type SyncReport = z.infer<typeof syncReportSchema>;
export declare function serializeSyncReport(report: SyncReport): string;

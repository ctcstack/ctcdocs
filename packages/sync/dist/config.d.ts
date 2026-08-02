import type { SiteConfiguration } from '@ctcstack/ctcdocs-core';
import { z } from 'zod';
/**
 * The schema is built per project rather than declared once, because two of the
 * defaults are project facts: the canonical origin generated links point at,
 * and the locale assumed for a document whose language cannot be determined.
 */
export declare function createSyncConfigurationSchema(site: SiteConfiguration): z.ZodObject<{
    GOOGLE_DRIVE_ID: z.ZodString;
    GOOGLE_ROOT_FOLDER_ID: z.ZodString;
    GOOGLE_IGNORED_FOLDER_IDS: z.ZodPipe<z.ZodDefault<z.ZodString>, z.ZodTransform<string[], string>>;
    SYNC_CONCURRENCY: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    SYNC_MAX_RETRIES: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    SYNC_FAIL_ON_WARNING: z.ZodDefault<z.ZodPipe<z.ZodEnum<{
        true: "true";
        false: "false";
    }>, z.ZodTransform<boolean, "true" | "false">>>;
    SYNC_EXPORT_TIMEOUT_MS: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    SYNC_SITE_BASE_URL: z.ZodDefault<z.ZodString>;
    SYNC_DEFAULT_LOCALE: z.ZodDefault<z.ZodString>;
    SYNC_DRY_RUN: z.ZodDefault<z.ZodPipe<z.ZodEnum<{
        true: "true";
        false: "false";
    }>, z.ZodTransform<boolean, "true" | "false">>>;
}, z.core.$strip>;
export type SyncConfiguration = z.infer<ReturnType<typeof createSyncConfigurationSchema>>;
export declare function parseSyncConfiguration(environment: Record<string, string | undefined>, site: SiteConfiguration): SyncConfiguration;

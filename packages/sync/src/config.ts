import type { SiteConfiguration } from '@ctcstack/ctcdocs-core';
import { z } from 'zod';

const googleDriveIdentifier = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]+$/u, 'Invalid Google Drive identifier');

const booleanFromString = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

/**
 * The schema is built per project rather than declared once, because two of the
 * defaults are project facts: the canonical origin generated links point at,
 * and the locale assumed for a document whose language cannot be determined.
 */
export function createSyncConfigurationSchema(site: SiteConfiguration) {
  return z.object({
    GOOGLE_DRIVE_ID: googleDriveIdentifier,
    GOOGLE_ROOT_FOLDER_ID: googleDriveIdentifier,
    GOOGLE_IGNORED_FOLDER_IDS: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
          .map((identifier) => googleDriveIdentifier.parse(identifier)),
      ),
    SYNC_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(4),
    SYNC_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(5),
    SYNC_FAIL_ON_WARNING: booleanFromString.default(false),
    SYNC_EXPORT_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(300_000)
      .default(60_000),
    /*
     * The canonical site address is a project fact, so it comes from
     * the project's site.config.json. The variable stays available to point a run at a
     * different origin, which is what the protected test corpus needs.
     */
    SYNC_SITE_BASE_URL: z
      .string()
      .url()
      .default(site.deployment.environments.production.url),
    SYNC_DEFAULT_LOCALE: z.string().min(2).default(site.sync.defaultLocale),
    SYNC_DRY_RUN: booleanFromString.default(false),
  });
}

export type SyncConfiguration = z.infer<
  ReturnType<typeof createSyncConfigurationSchema>
>;

export function parseSyncConfiguration(
  environment: Record<string, string | undefined>,
  site: SiteConfiguration,
): SyncConfiguration {
  /*
   * An `.env` copied from `.env.example` carries empty placeholders for the
   * variables that have a project-configuration fallback. An empty string is
   * not a value, so it is dropped here and the default applies; otherwise the
   * placeholder would fail validation instead of deferring to the default.
   */
  const provided = Object.fromEntries(
    Object.entries(environment).filter(([, value]) => value !== ''),
  );
  return createSyncConfigurationSchema(site).parse(provided);
}

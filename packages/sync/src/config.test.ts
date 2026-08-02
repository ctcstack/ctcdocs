import { describe, expect, it } from 'vitest';

import { parseSyncConfiguration } from './config.js';
import { testSiteConfiguration } from './test-support/project-fixture.js';

const requiredEnvironment = {
  GOOGLE_DRIVE_ID: 'drive-id',
  GOOGLE_ROOT_FOLDER_ID: 'root-id',
  SYNC_SITE_BASE_URL: 'https://wiki.example.com',
};

describe('sync configuration', () => {
  it('applies safe defaults', () => {
    expect(
      parseSyncConfiguration(requiredEnvironment, testSiteConfiguration),
    ).toEqual({
      ...requiredEnvironment,
      GOOGLE_IGNORED_FOLDER_IDS: [],
      SYNC_CONCURRENCY: 4,
      SYNC_MAX_RETRIES: 5,
      SYNC_FAIL_ON_WARNING: false,
      SYNC_EXPORT_TIMEOUT_MS: 60_000,
      SYNC_DEFAULT_LOCALE: 'en',
      SYNC_DRY_RUN: false,
    });
  });

  it('falls back to the configured production origin and locale', () => {
    const parsed = parseSyncConfiguration(
      {
        GOOGLE_DRIVE_ID: 'drive-id',
        GOOGLE_ROOT_FOLDER_ID: 'root-id',
      },
      testSiteConfiguration,
    );

    expect(parsed.SYNC_SITE_BASE_URL).toBe(
      testSiteConfiguration.deployment.environments.production.url,
    );
    expect(parsed.SYNC_DEFAULT_LOCALE).toBe(
      testSiteConfiguration.sync.defaultLocale,
    );
  });

  it('parses bounded values and ignored folder IDs', () => {
    const parsed = parseSyncConfiguration(
      {
        ...requiredEnvironment,
        GOOGLE_IGNORED_FOLDER_IDS: 'one, two ,,three',
        SYNC_CONCURRENCY: '8',
        SYNC_MAX_RETRIES: '2',
        SYNC_FAIL_ON_WARNING: 'true',
        SYNC_EXPORT_TIMEOUT_MS: '45000',
        SYNC_DEFAULT_LOCALE: 'ru',
        SYNC_DRY_RUN: 'true',
      },
      testSiteConfiguration,
    );

    expect(parsed.GOOGLE_IGNORED_FOLDER_IDS).toEqual(['one', 'two', 'three']);
    expect(parsed.SYNC_CONCURRENCY).toBe(8);
    expect(parsed.SYNC_FAIL_ON_WARNING).toBe(true);
    expect(parsed.SYNC_DRY_RUN).toBe(true);
  });

  it('rejects missing scope and dangerous concurrency', () => {
    expect(() => parseSyncConfiguration({}, testSiteConfiguration)).toThrow();
    expect(() =>
      parseSyncConfiguration(
        {
          ...requiredEnvironment,
          SYNC_CONCURRENCY: '1000',
        },
        testSiteConfiguration,
      ),
    ).toThrow();
    expect(() =>
      parseSyncConfiguration(
        {
          ...requiredEnvironment,
          GOOGLE_ROOT_FOLDER_ID: '../unsafe',
        },
        testSiteConfiguration,
      ),
    ).toThrow('Invalid Google Drive identifier');
  });
});

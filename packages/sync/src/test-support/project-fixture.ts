/**
 * A synthetic project for the tests to act on.
 *
 * The platform has no configuration of its own, so every test that touches a
 * marker, a hostname or a project path builds one here. The values are
 * deliberately fictional: a test that asserted a real deployment's title would
 * be describing one company's site rather than the pipeline's behavior.
 */
import {
  parseSiteConfiguration,
  type SiteConfiguration,
} from '@ctcstack/ctcdocs-core';

import { createSyncContext, type SyncContext } from '../project-context.js';

const TEST_SITE_CONFIGURATION_INPUT = {
  brand: {
    name: 'Example',
    siteTitle: 'Example [DOCS]',
    siteDescription: 'Internal Example documentation',
    faviconPath: '/favicon.svg',
  },
  deployment: {
    workerName: 'example-docs',
    environments: {
      production: { url: 'https://docs.example.com' },
    },
  },
  home: {
    lede: 'Every document here is published from Google Docs and is read-only.',
  },
  navigation: {
    landingDocumentTitles: ['Overview', 'README', 'About'],
    sectionIndexPages: true,
  },
  sync: {
    generatedBy: 'EXAMPLE SYNC',
    commitBotName: 'example-sync[bot]',
    defaultLocale: 'en',
  },
} as const;

export const testSiteConfiguration: SiteConfiguration = parseSiteConfiguration(
  TEST_SITE_CONFIGURATION_INPUT,
);

/** The same project, published to anyone rather than to an audience. */
export const publicSiteConfiguration: SiteConfiguration =
  parseSiteConfiguration({
    ...TEST_SITE_CONFIGURATION_INPUT,
    deployment: {
      ...TEST_SITE_CONFIGURATION_INPUT.deployment,
      environments: {
        production: {
          ...TEST_SITE_CONFIGURATION_INPUT.deployment.environments.production,
          visibility: 'public',
        },
      },
    },
  });

export function testSyncContext(repositoryRoot: string): SyncContext {
  return createSyncContext(repositoryRoot, testSiteConfiguration);
}

export const TEST_MARKDOWN_HEADER = testSyncContext('/').markdownHeader;

export const TEST_SOURCE_HEADER = testSyncContext('/').sourceHeader;

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  generatedMarkdownHeader,
  generatedSourceHeader,
} from './ownership-markers.js';
import { PROJECT_LAYOUT } from './project-layout.js';
import {
  loadSiteConfiguration,
  parseSiteConfiguration,
} from './site-configuration.js';

function validConfiguration(): Record<string, unknown> {
  return {
    brand: {
      name: 'Example',
      siteTitle: 'Example [DOCS]',
      siteDescription: 'Internal Example documentation',
      faviconPath: '/favicon.svg',
    },
    deployment: {
      workerName: 'example-docs',
      environments: {
        development: { url: 'https://docs-dev.example.com' },
        production: { url: 'https://docs.example.com' },
      },
    },
    home: {
      lede: 'Every document here is published from Google Docs and is read-only.',
    },
    navigation: {
      landingDocumentTitles: ['Overview', 'README'],
      sectionIndexPages: true,
    },
    sync: {
      generatedBy: 'EXAMPLE SYNC',
      commitBotName: 'example-sync[bot]',
      defaultLocale: 'en',
    },
  };
}

function environmentsOf(raw: Record<string, unknown>): Record<string, unknown> {
  return (raw.deployment as Record<string, unknown>).environments as Record<
    string,
    unknown
  >;
}

describe('parseSiteConfiguration', () => {
  it('derives the hostname a Wrangler route has to bind', () => {
    const parsed = parseSiteConfiguration(validConfiguration());

    expect(parsed.deployment.environments.production).toEqual({
      hostname: 'docs.example.com',
      url: 'https://docs.example.com',
      visibility: 'private',
    });
  });

  it('reads a portal anyone may open', () => {
    const raw = validConfiguration();
    environmentsOf(raw).production = {
      url: 'https://docs.example.com',
      visibility: 'public',
    };

    expect(
      parseSiteConfiguration(raw).deployment.environments.production,
    ).toEqual({
      hostname: 'docs.example.com',
      url: 'https://docs.example.com',
      visibility: 'public',
    });
  });

  it('lets environments differ in who may read them', () => {
    const raw = validConfiguration();
    environmentsOf(raw).development = {
      url: 'https://docs-dev.example.com',
      visibility: 'private',
    };
    environmentsOf(raw).production = {
      url: 'https://docs.example.com',
      visibility: 'public',
    };

    const { environments } = parseSiteConfiguration(raw).deployment;

    expect(environments.development?.visibility).toBe('private');
    expect(environments.production.visibility).toBe('public');
  });

  it.each([['internal'], [true], [null]])(
    'rejects %s as a visibility',
    (visibility) => {
      const raw = validConfiguration();
      environmentsOf(raw).production = {
        url: 'https://docs.example.com',
        visibility,
      };

      expect(() => parseSiteConfiguration(raw)).toThrow(
        /visibility must be "private" or "public"/u,
      );
    },
  );

  it('trims surrounding whitespace out of every value', () => {
    const raw = validConfiguration();
    (raw.brand as Record<string, unknown>).siteTitle = '  Example [DOCS]  ';

    expect(parseSiteConfiguration(raw).brand.siteTitle).toBe('Example [DOCS]');
  });

  it.each([
    ['http://docs.example.com', 'a plaintext origin'],
    ['https://user:pass@docs.example.com', 'embedded credentials'],
    ['https://docs.example.com/docs', 'a path'],
    ['https://docs.example.com/?token=secret', 'a query'],
    ['docs.example.com', 'no scheme'],
  ])('rejects %s (%s)', (url) => {
    const raw = validConfiguration();
    environmentsOf(raw).production = { url };

    expect(() => parseSiteConfiguration(raw)).toThrow(
      /deployment\.environments\.production\.url/u,
    );
  });

  it('accepts a deployment that publishes production only', () => {
    const raw = validConfiguration();
    delete environmentsOf(raw).development;

    const parsed = parseSiteConfiguration(raw);

    expect(Object.keys(parsed.deployment.environments)).toEqual(['production']);
  });

  it('accepts environments a project invents for itself', () => {
    const raw = validConfiguration();
    environmentsOf(raw).staging = { url: 'https://docs-staging.example.com' };

    const parsed = parseSiteConfiguration(raw);

    expect(parsed.deployment.environments.staging?.hostname).toBe(
      'docs-staging.example.com',
    );
  });

  it('rejects a deployment with no production environment', () => {
    const raw = validConfiguration();
    delete environmentsOf(raw).production;

    expect(() => parseSiteConfiguration(raw)).toThrow(
      /must define a production environment/u,
    );
  });

  it('rejects one hostname serving two environments', () => {
    const raw = validConfiguration();
    environmentsOf(raw).development = { url: 'https://docs.example.com' };

    expect(() => parseSiteConfiguration(raw)).toThrow(
      /must not reuse the hostname/u,
    );
  });

  it('rejects an environment name Wrangler would not accept', () => {
    const raw = validConfiguration();
    environmentsOf(raw)['Pre Production'] = {
      url: 'https://docs-pre.example.com',
    };

    expect(() => parseSiteConfiguration(raw)).toThrow(
      /deployment\.environments\.Pre Production/u,
    );
  });

  it('rejects a Worker name Cloudflare would not accept', () => {
    const raw = validConfiguration();
    (raw.deployment as Record<string, unknown>).workerName = 'Example Docs';

    expect(() => parseSiteConfiguration(raw)).toThrow(
      /deployment\.workerName/u,
    );
  });

  it('keeps the landing titles in the order they are configured', () => {
    const raw = validConfiguration();
    (raw.navigation as Record<string, unknown>).landingDocumentTitles = [
      ' About ',
      'Overview',
    ];

    expect(
      parseSiteConfiguration(raw).navigation.landingDocumentTitles,
    ).toEqual(['About', 'Overview']);
  });

  it.each<[unknown, string]>([
    [[], 'an empty list'],
    [['Overview', ''], 'an empty title'],
    [['Overview', 'overview'], 'a title repeated in another case'],
    ['Overview', 'a bare string'],
  ])('rejects %s as landing titles (%s)', (titles) => {
    const raw = validConfiguration();
    (raw.navigation as Record<string, unknown>).landingDocumentTitles = titles;

    expect(() => parseSiteConfiguration(raw)).toThrow(
      /navigation\.landingDocumentTitles/u,
    );
  });

  it.each<[unknown]>([['true'], [1], [undefined]])(
    'rejects %s as the section index switch',
    (value) => {
      const raw = validConfiguration();
      (raw.navigation as Record<string, unknown>).sectionIndexPages = value;

      expect(() => parseSiteConfiguration(raw)).toThrow(
        /navigation\.sectionIndexPages must be true or false/u,
      );
    },
  );

  it('rejects a home page that opens with nothing', () => {
    const raw = validConfiguration();
    (raw.home as Record<string, unknown>).lede = '   ';

    expect(() => parseSiteConfiguration(raw)).toThrow(
      /home\.lede must be a non-empty string/u,
    );
  });

  it('composes the home page the way it did before these options existed', () => {
    expect(parseSiteConfiguration(validConfiguration()).home).toEqual({
      lede: 'Every document here is published from Google Docs and is read-only.',
      recentLimit: 6,
      corpusIndex: true,
    });
  });

  it('lets a project decide how far the recent band reaches', () => {
    const raw = validConfiguration();
    (raw.home as Record<string, unknown>).recentLimit = 10;

    expect(parseSiteConfiguration(raw).home.recentLimit).toBe(10);
  });

  it.each<[unknown, string]>([
    [0, 'a band that would show nothing'],
    [-1, 'a negative count'],
    [2.5, 'a fraction'],
    ['10', 'a numeral written as text'],
  ])('rejects %s as a recent limit (%s)', (value) => {
    const raw = validConfiguration();
    (raw.home as Record<string, unknown>).recentLimit = value;

    expect(() => parseSiteConfiguration(raw)).toThrow(
      /home\.recentLimit must be a whole number of at least 1/u,
    );
  });

  it('lets a project keep the index off its home page', () => {
    const raw = validConfiguration();
    (raw.home as Record<string, unknown>).corpusIndex = false;

    expect(parseSiteConfiguration(raw).home.corpusIndex).toBe(false);
  });

  it('takes the index off the home page of a corpus without folder pages', () => {
    const raw = validConfiguration();
    (raw.home as Record<string, unknown>).corpusIndex = false;
    (raw.navigation as Record<string, unknown>).sectionIndexPages = false;

    const parsed = parseSiteConfiguration(raw);

    expect(parsed.home.corpusIndex).toBe(false);
    expect(parsed.navigation.sectionIndexPages).toBe(false);
  });

  it.each<[unknown]>([['false'], [0], [null]])(
    'rejects %s as the home index switch',
    (value) => {
      const raw = validConfiguration();
      (raw.home as Record<string, unknown>).corpusIndex = value;

      expect(() => parseSiteConfiguration(raw)).toThrow(
        /home\.corpusIndex must be true or false/u,
      );
    },
  );

  it('rejects a generated-by marker that would close its own HTML comment', () => {
    const raw = validConfiguration();
    (raw.sync as Record<string, unknown>).generatedBy = 'EXAMPLE --> SYNC';

    expect(() => parseSiteConfiguration(raw)).toThrow(/sync\.generatedBy/u);
  });

  it.each(['brand', 'deployment', 'home', 'navigation', 'sync'])(
    'rejects a missing %s section',
    (section) => {
      const raw = validConfiguration();
      raw[section] = undefined;

      expect(() => parseSiteConfiguration(raw)).toThrow(
        new RegExp(`${section} must be an object`, 'u'),
      );
    },
  );

  it('rejects an empty required string', () => {
    const raw = validConfiguration();
    (raw.brand as Record<string, unknown>).siteTitle = '   ';

    expect(() => parseSiteConfiguration(raw)).toThrow(/brand\.siteTitle/u);
  });
});

describe('loadSiteConfiguration', () => {
  function writeProject(configuration: unknown): string {
    const root = mkdtempSync(resolve(tmpdir(), 'ctcdocs-core-'));
    writeFileSync(
      resolve(root, PROJECT_LAYOUT.configurationFile),
      JSON.stringify(configuration),
      'utf8',
    );
    return root;
  }

  it('reads and validates the configuration of the project it is given', () => {
    const root = writeProject(validConfiguration());

    expect(loadSiteConfiguration(root).brand.name).toBe('Example');
  });

  it('reports the file it could not read rather than the value it wanted', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'ctcdocs-core-'));

    expect(() => loadSiteConfiguration(root)).toThrow(
      new RegExp(`${PROJECT_LAYOUT.configurationFile} could not be read`, 'u'),
    );
  });

  it('rejects an invalid configuration at load time, not at first use', () => {
    const raw = validConfiguration();
    (raw.brand as Record<string, unknown>).faviconPath = 'favicon.svg';
    const root = writeProject(raw);

    expect(() => loadSiteConfiguration(root)).toThrow(/brand\.faviconPath/u);
  });
});

describe('ownership markers', () => {
  it('derives both forms from one configured name', () => {
    const configuration = parseSiteConfiguration(validConfiguration());
    const { generatedBy } = configuration.sync;

    expect(generatedMarkdownHeader(configuration)).toBe(
      `<!-- AUTO-GENERATED BY ${generatedBy}. DO NOT EDIT. -->`,
    );
    expect(generatedSourceHeader(configuration)).toBe(
      `// AUTO-GENERATED BY ${generatedBy}. DO NOT EDIT.`,
    );
  });
});

import { describe, expect, it } from 'vitest';

import { parseSiteConfiguration } from './site-configuration.js';

function configuration(access: unknown, visibility?: string) {
  return {
    ...(access === undefined ? {} : { access }),
    brand: {
      name: 'Example',
      siteTitle: 'Example [DOCS]',
      siteDescription: 'Synthetic documentation',
      faviconPath: '/favicon.svg',
    },
    deployment: {
      workerName: 'example-docs',
      environments: {
        production: {
          url: 'https://docs.example.com',
          ...(visibility ? { visibility } : {}),
        },
      },
    },
    home: { lede: 'Synthetic.' },
    navigation: {
      landingDocumentTitles: ['Overview'],
      sectionIndexPages: true,
    },
    sync: {
      generatedBy: 'EXAMPLE SYNC',
      commitBotName: 'example-sync[bot]',
      defaultLocale: 'en',
    },
  };
}

const rule = (overrides: Record<string, unknown> = {}) => ({
  folder: 'folder-a',
  label: 'Team A',
  readers: ['team-a@example.com'],
  ...overrides,
});

describe('access configuration', () => {
  it('is absent unless the project names it', () => {
    expect(parseSiteConfiguration(configuration(undefined)).access).toBe(
      undefined,
    );
  });

  it('lowercases and sorts group addresses', () => {
    const parsed = parseSiteConfiguration(
      configuration({
        admins: ['Docs-Admins@Example.com'],
        rules: [rule({ readers: ['zeta@example.com', ' Alpha@Example.com '] })],
      }),
    );
    expect(parsed.access).toEqual({
      admins: ['docs-admins@example.com'],
      rules: [
        {
          folder: 'folder-a',
          label: 'Team A',
          readers: ['alpha@example.com', 'zeta@example.com'],
        },
      ],
    });
  });

  it('accepts every member, alone', () => {
    const parsed = parseSiteConfiguration(
      configuration({
        admins: ['admins@example.com'],
        rules: [rule({ readers: ['*'] })],
      }),
    );
    expect(parsed.access?.rules[0]?.readers).toEqual(['*']);
    expect(() =>
      parseSiteConfiguration(
        configuration({
          admins: ['admins@example.com'],
          rules: [rule({ readers: ['*', 'team@example.com'] })],
        }),
      ),
    ).toThrow(/access\.rules\[0\]\.readers must be \["\*"\] alone/u);
  });

  it.each([
    [{ admins: [], rules: [] }, /access\.admins must be a non-empty array/u],
    [{ admins: ['*'], rules: [] }, /access\.admins\[0\] must be a group/u],
    [{ admins: ['not an address'], rules: [] }, /must be a group address/u],
    [{ admins: ['a@example.com'] }, /access\.rules must be an array/u],
    [
      { admins: ['a@example.com'], rules: [], extra: true },
      /access\.extra is not a known setting/u,
    ],
    [
      { admins: ['a@example.com'], rules: [rule({ group: 'x' })] },
      /access\.rules\[0\]\.group is not a known setting/u,
    ],
    [
      { admins: ['a@example.com'], rules: [rule({ folder: '../x' })] },
      /folder must be a Drive folder ID/u,
    ],
    [
      { admins: ['a@example.com'], rules: [rule(), rule()] },
      /access\.rules\[1\]\.folder must not have a second rule/u,
    ],
    [
      { admins: ['a@example.com'], rules: [rule({ label: ' ' })] },
      /label must be the folder's name/u,
    ],
    [
      {
        admins: ['a@example.com'],
        rules: [rule({ readers: ['a@example.com', 'A@example.com'] })],
      },
      /readers must not repeat a group/u,
    ],
  ])('rejects %j', (access, message) => {
    expect(() => parseSiteConfiguration(configuration(access))).toThrow(
      message,
    );
  });

  it('is refused while an environment is public', () => {
    expect(() =>
      parseSiteConfiguration(
        configuration(
          { admins: ['admins@example.com'], rules: [rule()] },
          'public',
        ),
      ),
    ).toThrow(/access must not be set while the production environment/u);
  });
});

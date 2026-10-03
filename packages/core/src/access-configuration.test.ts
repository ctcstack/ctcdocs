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

describe('sign-in configuration', () => {
  const withSignIn = (signIn: unknown) => ({
    ...configuration(undefined),
    signIn,
  });

  it('lowercases the Workspace domains', () => {
    expect(
      parseSiteConfiguration(
        withSignIn({ workspaceDomains: ['Example.com', 'example.org'] }),
      ).signIn,
    ).toEqual({ workspaceDomains: ['example.com', 'example.org'] });
  });

  it.each([
    [{ workspaceDomains: [] }, /must be a non-empty array of domains/u],
    [{ workspaceDomains: ['not a domain'] }, /must be a domain such as/u],
    [{ workspaceDomains: ['a.com', 'A.com'] }, /must not repeat a domain/u],
    [
      { workspaceDomains: ['a.com'], extra: 1 },
      /signIn\.extra is not a known/u,
    ],
  ])('rejects %j', (signIn, message) => {
    expect(() => parseSiteConfiguration(withSignIn(signIn))).toThrow(message);
  });
});

describe('MCP configuration', () => {
  const withMcp = (
    mcp: unknown,
    {
      signIn = true,
      visibility,
    }: { signIn?: boolean; visibility?: string } = {},
  ) => ({
    ...configuration(undefined, visibility),
    ...(signIn ? { signIn: { workspaceDomains: ['example.com'] } } : {}),
    mcp,
  });

  it('is absent unless the project sets it', () => {
    expect(
      parseSiteConfiguration(configuration(undefined)).mcp,
    ).toBeUndefined();
  });

  it('turns the server on for a private deployment that signs readers in', () => {
    expect(parseSiteConfiguration(withMcp({ enabled: true })).mcp).toEqual({
      enabled: true,
    });
  });

  it('may be switched off without sign-in', () => {
    expect(
      parseSiteConfiguration(withMcp({ enabled: false }, { signIn: false }))
        .mcp,
    ).toEqual({ enabled: false });
  });

  it.each([
    [{}, /mcp\.enabled must be true or false/u],
    [{ enabled: 'yes' }, /mcp\.enabled must be true or false/u],
    [{ enabled: true, extra: 1 }, /mcp\.extra is not a known/u],
    ['on', /mcp must be an object/u],
  ])('rejects %j', (mcp, message) => {
    expect(() => parseSiteConfiguration(withMcp(mcp))).toThrow(message);
  });

  it('needs sign-in', () => {
    expect(() =>
      parseSiteConfiguration(withMcp({ enabled: true }, { signIn: false })),
    ).toThrow(/mcp needs signIn/u);
  });

  it('is refused while an environment is public', () => {
    expect(() =>
      parseSiteConfiguration(
        withMcp({ enabled: true }, { visibility: 'public' }),
      ),
    ).toThrow(/mcp must not be enabled while the production environment/u);
  });
});

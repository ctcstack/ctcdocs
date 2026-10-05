import { describe, expect, it } from 'vitest';

import { MCP_DEFAULTS, parseSiteConfiguration } from './site-configuration.js';

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
      ...MCP_DEFAULTS,
    });
  });

  it('may be switched off without sign-in', () => {
    expect(
      parseSiteConfiguration(withMcp({ enabled: false }, { signIn: false }))
        .mcp,
    ).toEqual({ enabled: false, ...MCP_DEFAULTS });
  });

  it('takes the search settings a project sets, and defaults the rest', () => {
    const mcp = parseSiteConfiguration(
      withMcp({
        enabled: true,
        search: {
          chunks: 30,
          vectorThreshold: 0.35,
          keywordMatch: 'and',
          reranking: { threshold: 0.25 },
          results: 5,
        },
        fetchCharacters: 60_000,
        browseCharacters: 48_000,
        recent: { results: 100 },
      }),
    ).mcp;
    expect(mcp).toEqual({
      enabled: true,
      search: {
        ...MCP_DEFAULTS.search,
        chunks: 30,
        vectorThreshold: 0.35,
        keywordMatch: 'and',
        reranking: { ...MCP_DEFAULTS.search.reranking, threshold: 0.25 },
        results: 5,
      },
      fetchCharacters: 60_000,
      browseCharacters: 48_000,
      recent: { defaultResults: 20, results: 100 },
    });
  });

  it('takes the passage budget a project set before results defaulted to 15', () => {
    expect(
      parseSiteConfiguration(
        withMcp({ enabled: true, search: { passageCharacters: 1_200 } }),
      ).mcp?.search,
    ).toMatchObject({ results: 15, passageCharacters: 1_200 });
  });

  it('lists no more recent changes by default than a call may ask for', () => {
    expect(
      parseSiteConfiguration(withMcp({ enabled: true, recent: { results: 5 } }))
        .mcp?.recent,
    ).toEqual({ defaultResults: 5, results: 5 });
  });

  it.each([
    [1, 1],
    [5, 5],
    [20, 15],
  ])(
    'returns no more results by default than the %d chunks it asks for',
    (chunks, results) => {
      const mcp = parseSiteConfiguration(
        withMcp({ enabled: true, search: { chunks } }),
      ).mcp;
      expect(mcp?.search.results).toBe(results);
    },
  );

  it('starts from the values ADR-042 records', () => {
    expect(MCP_DEFAULTS).toEqual({
      search: {
        chunks: 50,
        vectorThreshold: 0.2,
        keywordMatch: 'or',
        contextChunks: 0,
        reranking: {
          enabled: true,
          model: '@cf/baai/bge-reranker-base',
          threshold: 0,
        },
        results: 15,
        passagesPerResult: 3,
        passageCharacters: 24_000,
      },
      fetchCharacters: 100_000,
      browseCharacters: 24_000,
      recent: { defaultResults: 20, results: 50 },
    });
  });

  it.each([
    [{ chunks: 0 }, /mcp\.search\.chunks must be a whole number from 1 to 50/u],
    [
      { chunks: 51 },
      /mcp\.search\.chunks must be a whole number from 1 to 50/u,
    ],
    [{ chunks: 2.5 }, /mcp\.search\.chunks must be a whole number/u],
    [{ vectorThreshold: 1.5 }, /vectorThreshold must be a number from 0 to 1/u],
    [{ keywordMatch: 'any' }, /keywordMatch must be "and" or "or"/u],
    [{ contextChunks: 4 }, /contextChunks must be a whole number from 0 to 3/u],
    [
      { reranking: { enabled: 'yes' } },
      /reranking\.enabled must be true or false/u,
    ],
    [
      { reranking: { model: ' ' } },
      /reranking\.model must be a non-empty string/u,
    ],
    [
      { reranking: { threshold: -0.1 } },
      /reranking\.threshold must be a number from 0 to 1/u,
    ],
    [
      { reranking: { extra: 1 } },
      /mcp\.search\.reranking\.extra is not a known/u,
    ],
    [{ chunks: 5, results: 6 }, /results must be a whole number from 1 to 5/u],
    [
      { passagesPerResult: 0 },
      /passagesPerResult must be a whole number of at least 1/u,
    ],
    [
      { passageCharacters: 999 },
      /passageCharacters must be a whole number of at least 1000/u,
    ],
    [{ extra: 1 }, /mcp\.search\.extra is not a known/u],
    ['many', /mcp\.search must be an object/u],
  ])('rejects the search setting %j', (search, message) => {
    expect(() =>
      parseSiteConfiguration(withMcp({ enabled: true, search })),
    ).toThrow(message);
  });

  it('refuses a fetch limit under 1,000 characters', () => {
    expect(() =>
      parseSiteConfiguration(withMcp({ enabled: true, fetchCharacters: 500 })),
    ).toThrow(/mcp\.fetchCharacters must be a whole number of at least 1000/u);
  });

  it('refuses a browse budget under 1,000 characters', () => {
    expect(() =>
      parseSiteConfiguration(withMcp({ enabled: true, browseCharacters: 500 })),
    ).toThrow(/mcp\.browseCharacters must be a whole number of at least 1000/u);
  });

  it.each([
    [
      { results: 0 },
      /mcp\.recent\.results must be a whole number of at least 1/u,
    ],
    [
      { results: 10, defaultResults: 11 },
      /mcp\.recent\.defaultResults must be a whole number from 1 to 10/u,
    ],
    [{ extra: 1 }, /mcp\.recent\.extra is not a known/u],
    ['many', /mcp\.recent must be an object/u],
  ])('rejects the recent setting %j', (recent, message) => {
    expect(() =>
      parseSiteConfiguration(withMcp({ enabled: true, recent })),
    ).toThrow(message);
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

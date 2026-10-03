import {
  ADMINS_CLASS,
  computeAccessModel,
  MEMBERS_CLASS,
  parseCorpusStructure,
} from '@ctcstack/ctcdocs-core';
import { describe, expect, it } from 'vitest';

import {
  buildAccessMap,
  canonicalSitePath,
  PLATFORM_FILE,
  type BuiltPage,
} from './access-map.js';
import { readBuiltPage } from './build-output.js';

const corpus = parseCorpusStructure({
  rootFolderId: 'root',
  folders: {
    root: { googleParentId: null, googleName: 'R', displayLabel: 'R' },
    open: {
      googleParentId: 'root',
      googleName: 'Open',
      displayLabel: 'Open',
      stableSlug: 'open',
    },
    team: {
      googleParentId: 'root',
      googleName: 'Team',
      displayLabel: 'Team',
      stableSlug: 'team',
    },
  },
  documents: {
    'doc-open': { googleParentId: 'open', stableSlug: 'open/guide' },
    'doc-team': { googleParentId: 'team', stableSlug: 'team/plan' },
  },
});

const access = {
  admins: ['admins@example.com'],
  rules: [
    { folder: 'open', label: 'Open', readers: ['*'] },
    { folder: 'team', label: 'Team', readers: ['team@example.com'] },
  ],
};

const page = (overrides: Partial<BuiltPage> & { path: string }): BuiltPage => ({
  source: undefined,
  redirect: false,
  searchable: false,
  images: [],
  ...overrides,
});

describe('canonicalSitePath', () => {
  it.each([
    ['index.html', '/'],
    ['team/plan/index.html', '/team/plan/'],
    ['404.html', '/404.html'],
    ['team/plan/index.md', '/team/plan/index.md'],
    ['_astro/a.webp', '/_astro/a.webp'],
  ])('%s → %s', (file, path) => {
    expect(canonicalSitePath(file)).toBe(path);
  });
});

describe('buildAccessMap', () => {
  const model = computeAccessModel(access, corpus);
  const team = model.documents['doc-team'] as string;

  const input = {
    model,
    corpus,
    pages: [
      page({ path: '/' }),
      page({ path: '/content-health/' }),
      page({ path: '/d/abc123/', redirect: true }),
      page({ path: '/about/', source: 'manual', searchable: true }),
      page({
        path: '/open/guide/',
        source: 'google-doc',
        searchable: true,
        images: ['/_astro/open.webp'],
      }),
      page({
        path: '/team/plan/',
        source: 'google-doc',
        searchable: true,
        images: ['/_astro/plan.webp'],
      }),
      page({ path: '/team/', source: 'section-index' }),
    ],
    files: [
      '/_astro/app.js',
      '/_astro/open.webp',
      '/_astro/plan.webp',
      '/_astro/orphan.webp',
      '/_astro/icon.svg',
      '/team/plan/index.md',
      '/assets/generated/doc-team/image-001.png',
      '/llms.txt',
      '/team/llms.txt',
      '/sitemap-0.xml',
      '/favicon.svg',
      '/stray.bin',
    ],
    publicFiles: new Set(['/favicon.svg']),
    stylesheetImages: new Set(['/_astro/icon.svg']),
  };

  it('gives every file the class of what it shows', () => {
    const map = buildAccessMap(input);
    expect(map.files).toMatchObject({
      '/': MEMBERS_CLASS,
      '/content-health/': ADMINS_CLASS,
      '/d/abc123/': MEMBERS_CLASS,
      '/about/': MEMBERS_CLASS,
      '/open/guide/': MEMBERS_CLASS,
      '/team/plan/': team,
      '/team/': team,
      '/team/plan/index.md': team,
      '/assets/generated/doc-team/image-001.png': team,
      '/_astro/open.webp': MEMBERS_CLASS,
      '/_astro/plan.webp': team,
      '/_astro/orphan.webp': ADMINS_CLASS,
      '/_astro/icon.svg': PLATFORM_FILE,
      '/_astro/app.js': PLATFORM_FILE,
      '/favicon.svg': PLATFORM_FILE,
      '/llms.txt': MEMBERS_CLASS,
      '/team/llms.txt': team,
      '/sitemap-0.xml': MEMBERS_CLASS,
    });
    expect(map.searchPages).toEqual({
      [MEMBERS_CLASS]: ['/about/', '/open/guide/'],
      [team]: ['/team/plan/'],
    });
  });

  it('names what it cannot place, and closes it under rules', () => {
    const map = buildAccessMap(input);
    expect(map.unplaced).toEqual(['/stray.bin']);
    expect(map.files['/stray.bin']).toBe(ADMINS_CLASS);
    const open = buildAccessMap({
      ...input,
      model: computeAccessModel(undefined, corpus),
    });
    expect(open.files['/stray.bin']).toBe(MEMBERS_CLASS);
    expect(open.files['/content-health/']).toBe(MEMBERS_CLASS);
  });

  it('finds a listing that shows a restricted document’s image', () => {
    const map = buildAccessMap({
      ...input,
      pages: [
        ...input.pages,
        page({
          path: '/news/',
          source: 'manual',
          images: ['/_astro/plan.webp'],
        }),
      ],
    });
    expect(map.sharedImages).toEqual(['/_astro/plan.webp']);
    expect(map.files['/_astro/plan.webp']).toBe(MEMBERS_CLASS);
  });
});

describe('readBuiltPage', () => {
  it('reads the source, the redirect, the search region and the images', () => {
    const built = readBuiltPage(
      '/team/plan/',
      `<html><head>
        <meta name="ctcdocs:source" content="google-doc">
        <meta property="og:image" content="https://docs.example.com/_astro/og.png">
        <link rel="preload" href="/_astro/hero.avif">
        <link rel="stylesheet" href="/_astro/index.css">
      </head><body><main data-pagefind-body>
        <img src="../../_astro/a.webp" srcset="/_astro/a-1.webp 1x, /_astro/a-2.webp 2x">
        <picture><source srcset="/_astro/b.avif"></picture>
        <div style="background: url('/_astro/c.png')"></div>
        <img src="https://elsewhere.example/_astro/x.png">
      </main></body></html>`,
    );
    expect(built).toEqual({
      path: '/team/plan/',
      source: 'google-doc',
      redirect: false,
      searchable: true,
      images: [
        '/_astro/a-1.webp',
        '/_astro/a-2.webp',
        '/_astro/a.webp',
        '/_astro/b.avif',
        '/_astro/c.png',
        '/_astro/hero.avif',
      ],
    });
    expect(
      readBuiltPage(
        '/d/abc123/',
        '<meta http-equiv="refresh" content="0;url=/team/plan/">',
      ).redirect,
    ).toBe(true);
  });
});

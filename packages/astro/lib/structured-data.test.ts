import { describe, expect, it } from 'vitest';

import { structuredData } from './structured-data.js';

const context = {
  siteName: 'Example [DOCS]',
  siteDescription: 'Synthetic documentation',
  siteUrl: 'https://docs.example.com/',
  pageUrl: 'https://docs.example.com/handbook/overview/',
};

describe('structured data', () => {
  it('describes the home page as the site', () => {
    expect(JSON.parse(structuredData({ kind: 'home' }, context))).toEqual({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'Example [DOCS]',
      url: 'https://docs.example.com/',
      description: 'Synthetic documentation',
    });
  });

  it('gives a document its source, edit date and Markdown version', () => {
    const json = structuredData(
      {
        kind: 'document',
        title: 'Overview',
        description: ' How the\n handbook works. ',
        modified: '2026-02-05T08:15:00.000Z',
        sourceUrl: 'https://docs.google.com/document/d/source/edit',
        markdownPath: '/handbook/overview/index.md',
      },
      context,
    );

    expect(JSON.parse(json)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: 'Overview',
      description: 'How the handbook works.',
      url: 'https://docs.example.com/handbook/overview/',
      dateModified: '2026-02-05T08:15:00.000Z',
      isBasedOn: 'https://docs.google.com/document/d/source/edit',
      encoding: {
        '@type': 'MediaObject',
        encodingFormat: 'text/markdown',
        contentUrl: 'https://docs.example.com/handbook/overview/index.md',
      },
      isPartOf: {
        '@type': 'WebSite',
        name: 'Example [DOCS]',
        url: 'https://docs.example.com/',
      },
    });
  });

  it('leaves out what a document does not have', () => {
    const data = JSON.parse(
      structuredData(
        {
          kind: 'document',
          title: 'Overview',
          description: '   ',
          modified: undefined,
          sourceUrl: undefined,
          markdownPath: '/handbook/overview/index.md',
        },
        context,
      ),
    ) as Record<string, unknown>;

    expect(data).not.toHaveProperty('description');
    expect(data).not.toHaveProperty('dateModified');
    expect(data).not.toHaveProperty('isBasedOn');
  });

  it('describes a section page as a collection', () => {
    expect(
      JSON.parse(
        structuredData({ kind: 'section', title: 'Handbook' }, context),
      ),
    ).toMatchObject({ '@type': 'CollectionPage', name: 'Handbook' });
  });

  it('cannot close the script element it is written into', () => {
    const json = structuredData(
      { kind: 'section', title: '</script><!-- & \u2028' },
      context,
    );

    expect(json).not.toMatch(/[<>&\u2028]/u);
    expect(JSON.parse(json)).toMatchObject({
      name: '</script><!-- & \u2028',
    });
  });
});

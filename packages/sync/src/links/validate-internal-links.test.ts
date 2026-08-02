import { describe, expect, it } from 'vitest';

import { findBrokenInternalLinks } from './validate-internal-links.js';

describe('internal page-link validation', () => {
  it('accepts generated, redirected, static, same-page, and external links', () => {
    expect(
      findBrokenInternalLinks(
        [
          {
            stableSlug: 'engineering/source',
            body: [
              '[Generated](/operations/target/)',
              '[Relative](../relative-target/)',
              '[Redirect](/legacy/target/)',
              '[Home](/)',
              '[Static](/about-wiki/)',
              '[Anchor](#heading)',
              '[External](https://example.invalid/path)',
            ].join('\n\n'),
          },
          { stableSlug: 'operations/target', body: '' },
          { stableSlug: 'engineering/relative-target', body: '' },
        ],
        new Set(['legacy/target']),
      ),
    ).toEqual([]);
  });

  it('reports missing targets deterministically without checking fragments', () => {
    expect(
      findBrokenInternalLinks([
        {
          stableSlug: 'z/source',
          body: '[Missing](/missing/page/#fragment)\n',
        },
        {
          stableSlug: 'a/source',
          body: '[Other](../missing/)\n',
        },
      ]),
    ).toEqual([
      { sourceSlug: 'a/source', targetPath: 'a/missing' },
      { sourceSlug: 'z/source', targetPath: 'missing/page' },
    ]);
  });
});

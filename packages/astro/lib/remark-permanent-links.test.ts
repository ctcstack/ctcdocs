import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import { describe, expect, it } from 'vitest';

import {
  remarkPermanentLinks,
  resolvePermanentLink,
} from './remark-permanent-links.js';

const redirects = {
  '/d/a1b2c3/': '/sales/pricing/',
  '/old-pricing/': '/sales/pricing/',
};

function render(markdown: string): string {
  return String(
    unified()
      .use(remarkParse)
      .use(remarkPermanentLinks(redirects))
      .use(remarkStringify)
      .processSync(markdown),
  );
}

describe('permanent links in rendered pages', () => {
  it('resolves a permanent link to the address it leads to', () => {
    expect(resolvePermanentLink('/d/a1b2c3/', redirects)).toBe(
      '/sales/pricing/',
    );
    expect(resolvePermanentLink('/d/a1b2c3', redirects)).toBe(
      '/sales/pricing/',
    );
    expect(resolvePermanentLink('/d/a1b2c3/#rates', redirects)).toBe(
      '/sales/pricing/#rates',
    );
    expect(resolvePermanentLink('/d/a1b2c3/?tab=1#rates', redirects)).toBe(
      '/sales/pricing/?tab=1#rates',
    );
  });

  it('leaves every other link alone', () => {
    expect(resolvePermanentLink('/d/ffffff/', redirects)).toBeUndefined();
    expect(resolvePermanentLink('/old-pricing/', redirects)).toBeUndefined();
    expect(
      resolvePermanentLink('https://example.com/d/a1b2c3/', redirects),
    ).toBeUndefined();
  });

  it('rewrites Markdown links, references and inline HTML', () => {
    const result = render(
      [
        '[Pricing](/d/a1b2c3/#rates)',
        '[Reference][pricing]',
        '[pricing]: /d/a1b2c3/',
        '<a href="/d/a1b2c3/">HTML pricing</a>',
      ].join('\n\n'),
    );

    expect(result).toContain('[Pricing](/sales/pricing/#rates)');
    expect(result).toContain('[pricing]: /sales/pricing/');
    expect(result).toContain('<a href="/sales/pricing/">HTML pricing</a>');
    expect(result).not.toContain('/d/a1b2c3/');
  });
});

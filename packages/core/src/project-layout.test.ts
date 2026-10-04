import { describe, expect, it } from 'vitest';

import {
  markdownProjectionPath,
  resolvePermanentLink,
} from './project-layout.js';

const redirects = {
  '/d/a1b2c3/': '/sales/pricing/',
  '/old-pricing/': '/sales/pricing/',
};

describe('permanent links', () => {
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
});

describe('Markdown projection', () => {
  it('is served at the page address plus index.md', () => {
    expect(markdownProjectionPath('section/guide')).toBe(
      '/section/guide/index.md',
    );
  });
});

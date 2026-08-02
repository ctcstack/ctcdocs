import { describe, expect, it } from 'vitest';

import {
  isAllowedLinkUrl,
  isAllowedSvgReference,
  resolveArchiveAssetPath,
} from './url-policy.js';

describe('HTML and SVG URL policy', () => {
  it.each([
    'https://example.invalid/path',
    'http://example.invalid/path',
    'mailto:docs@example.invalid',
    '#heading',
    '/internal/path',
    './relative',
    '../relative',
  ])('accepts safe link URL %s', (value) => {
    expect(isAllowedLinkUrl(value)).toBe(true);
  });

  it.each([
    '',
    ' javascript:alert(1)',
    'javascript:alert(1)',
    'data:text/html,unsafe',
    '//example.invalid/path',
    '\\\\example.invalid/path',
    'https://example.invalid/\nunsafe',
  ])('rejects unsafe link URL %s', (value) => {
    expect(isAllowedLinkUrl(value)).toBe(false);
  });

  it('resolves a relative archive asset path', () => {
    expect(
      resolveArchiveAssetPath('folder/document.html', 'images/pixel.png'),
    ).toBe('folder/images/pixel.png');
    expect(
      resolveArchiveAssetPath('folder/document.html', 'images/caf%C3%A9.png'),
    ).toBe('folder/images/café.png');
  });

  it.each([
    '../outside.png',
    '%2E%2E/outside.png',
    '/absolute.png',
    'C:\\outside.png',
    'https://example.invalid/image.png',
    '//example.invalid/image.png',
    'image.png?query=1',
    'image.png#fragment',
  ])('rejects unsafe archive asset path %s', (value) => {
    expect(resolveArchiveAssetPath('document.html', value)).toBeUndefined();
  });

  it('only accepts local SVG fragment references', () => {
    expect(isAllowedSvgReference('#gradient')).toBe(true);
    expect(
      isAllowedSvgReference('https://example.invalid/a.svg#gradient'),
    ).toBe(false);
    expect(isAllowedSvgReference('javascript:alert(1)')).toBe(false);
  });
});

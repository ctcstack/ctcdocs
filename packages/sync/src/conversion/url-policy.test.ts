import { describe, expect, it } from 'vitest';

import {
  isAllowedLinkUrl,
  isAllowedSvgReference,
  resolveArchiveAssetPath,
  unwrapGoogleRedirect,
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

describe('Google redirect wrappers', () => {
  it('reads the address a wrapper leads to', () => {
    expect(
      unwrapGoogleRedirect(
        'https://www.google.com/url?q=https://example.invalid/status&sa=D&source=editors&ust=1785672326246866&usg=AOvVaw0Q',
      ),
    ).toBe('https://example.invalid/status');
  });

  it('reads a wrapper without the www host and with the alternate parameter', () => {
    expect(
      unwrapGoogleRedirect(
        'https://google.com/url?url=https://example.invalid/',
      ),
    ).toBe('https://example.invalid/');
  });

  it.each([
    ['https://redirect.invalid/url?q=https://example.invalid/', 'another host'],
    [
      'https://www.google.com/search?q=https://example.invalid/',
      'another path',
    ],
    ['https://www.google.com/url?sa=D&usg=AOvVaw0Q', 'no target'],
    ['https://example.invalid/plain', 'a plain link'],
    ['not a url at all', 'unparsable input'],
  ])('leaves %s alone (%s)', (value) => {
    expect(unwrapGoogleRedirect(value)).toBeUndefined();
  });

  it.each([
    ['javascript:alert(1)', 'an executable scheme'],
    [
      '/relative/path',
      'a relative target that would resolve against this site',
    ],
    ['data:text/html,<script>', 'an inline document'],
  ])('refuses to unwrap to %s (%s)', (target) => {
    expect(
      unwrapGoogleRedirect(
        `https://www.google.com/url?q=${encodeURIComponent(target)}&sa=D`,
      ),
    ).toBeUndefined();
  });
});

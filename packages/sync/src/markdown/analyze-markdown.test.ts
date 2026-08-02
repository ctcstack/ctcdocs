import { describe, expect, it } from 'vitest';

import {
  collectMarkdownLinkUrls,
  collectMarkdownImageUrls,
  detectMarkdownFallbackReasons,
} from './analyze-markdown.js';

describe('Markdown fallback analysis', () => {
  it('returns no reason for basic Markdown', () => {
    expect(
      detectMarkdownFallbackReasons('# Title\n\nParagraph with [link](./a).'),
    ).toEqual([]);
  });

  it('detects media, tables, and raw HTML deterministically', () => {
    expect(
      detectMarkdownFallbackReasons(
        [
          '![image](data:image/png;base64,fixture)',
          '',
          '| A | B |',
          '| - | - |',
          '| 1 | 2 |',
          '',
          '<div>fallback</div>',
        ].join('\n'),
      ),
    ).toEqual(['html', 'image', 'table']);
  });

  it('collects inline and referenced image URLs structurally', () => {
    expect(
      collectMarkdownImageUrls(
        '![inline](./one.png)\n\n![reference][asset]\n\n[asset]: ./two.png\n\n<table><tr><td><img src="./three.png" alt="three"></td></tr></table>\n',
      ),
    ).toEqual(['./one.png', './two.png', './three.png']);
  });

  it('collects Markdown and HTML anchor URLs structurally', () => {
    expect(
      collectMarkdownLinkUrls(
        '[inline](/one/)\n\n[reference][page]\n\n[page]: /two/\n\n<table><tr><td><a href="/three/">three</a></td></tr></table>\n',
      ),
    ).toEqual(['/one/', '/two/', '/three/']);
  });
});

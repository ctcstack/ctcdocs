import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import type { ExtractedZipEntry } from '../archive/safe-zip.js';
import {
  convertHtmlArchive,
  HtmlArchiveConversionError,
} from './html-archive-converter.js';

const htmlFixtureDirectory = new URL('../../fixtures/html/', import.meta.url);
const svgFixtureDirectory = new URL('../../fixtures/svg/', import.meta.url);
const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

async function fixtureEntries(
  name: string,
  assets: readonly ExtractedZipEntry[] = [],
): Promise<ExtractedZipEntry[]> {
  return [
    {
      path: 'document.html',
      bytes: await readFile(new URL(name, htmlFixtureDirectory)),
    },
    ...assets,
  ];
}

const options = {
  documentId: 'synthetic-document',
  documentTitle: 'Synthetic document',
};

describe('HTML archive conversion', () => {
  it('deduplicates identical images and emits stable local references', async () => {
    const result = convertHtmlArchive(
      await fixtureEntries('duplicate-image.html', [
        { path: 'images/image1.png', bytes: pixel },
      ]),
      options,
    );

    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]).toMatchObject({
      markdownPath:
        '../../../assets/generated/synthetic-document/image-001.png',
      mimeType: 'image/png',
      repositoryPath: 'src/assets/generated/synthetic-document/image-001.png',
    });
    expect(
      result.body.match(
        /\.\.\/\.\.\/\.\.\/assets\/generated\/synthetic-document\/image-001\.png/gu,
      ),
    ).toHaveLength(2);
  });

  it('preserves a merged table as sanitized HTML', async () => {
    const result = convertHtmlArchive(
      await fixtureEntries('merged-table.html'),
      options,
    );

    expect(result.hasComplexTables).toBe(true);
    expect(result.body).toContain('<table>');
    expect(result.body).toContain('colspan="2"');
    expect(result.body).not.toContain('<!doctype');
  });

  it('converts a simple table to GitHub-flavored Markdown', () => {
    const result = convertHtmlArchive(
      [
        {
          path: 'document.html',
          bytes: new TextEncoder().encode(
            '<table><tr><th>A</th><th>B</th></tr><tr><td>one</td><td>two</td></tr></table>',
          ),
        },
      ],
      options,
    );

    expect(result.hasComplexTables).toBe(false);
    expect(result.body).toMatch(/\| A\s+\| B\s+\|/u);
    expect(result.body).toContain('| --- | --- |');
    expect(result.body).toContain('| one | two |');
  });

  it('preserves a table containing media as sanitized HTML', () => {
    const result = convertHtmlArchive(
      [
        {
          path: 'document.html',
          bytes: new TextEncoder().encode(
            '<table><tr><td><img src="images/pixel.png" alt="Pixel"></td></tr></table>',
          ),
        },
        { path: 'images/pixel.png', bytes: pixel },
      ],
      options,
    );

    expect(result.hasComplexTables).toBe(true);
    expect(result.body).toContain('<table>');
    expect(result.body).toContain(
      '../../../assets/generated/synthetic-document/image-001.png',
    );
  });

  it('removes active HTML, unsafe URLs, and external images', async () => {
    const result = convertHtmlArchive(
      await fixtureEntries('malicious.html'),
      options,
    );

    expect(result.sanitizedHtml).not.toMatch(
      /<(?:script|iframe|object|form)\b|onload=|onerror=|href="(?:javascript:|data:)/iu,
    );
    expect(result.body).toContain('https://example.invalid/safe');
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        'removed_unsafe_html_attribute',
        'removed_unsafe_image',
        'removed_unsafe_link',
        'removed_unsupported_html',
      ]),
    );
  });

  it('fails closed for missing or unsafe archive assets', async () => {
    const missingAssetEntries = await fixtureEntries('duplicate-image.html');
    expect(() => convertHtmlArchive(missingAssetEntries, options)).toThrow(
      HtmlArchiveConversionError,
    );

    const unsafeSvg = await readFile(
      new URL('malicious.svg', svgFixtureDirectory),
    );
    expect(() =>
      convertHtmlArchive(
        [
          {
            path: 'document.html',
            bytes: new TextEncoder().encode(
              '<p><img src="images/drawing.svg"></p>',
            ),
          },
          { path: 'images/drawing.svg', bytes: unsafeSvg },
        ],
        options,
      ),
    ).toThrow(HtmlArchiveConversionError);
  });

  it('carries Google redirect wrappers through for the link rewriter', async () => {
    const conversion = convertHtmlArchive(
      await fixtureEntries('google-redirect-links.html'),
      {
        documentId: 'doc-links',
        documentTitle: 'Google redirect link fixture',
      },
    );

    /*
     * The archive converter keeps the href Google wrote; unwrapping belongs to
     * the link rewriter, which is the one place that also knows which document
     * identifiers belong to this corpus. What matters here is that the wrapper
     * survives sanitization intact, signature and all, so the rewriter has
     * something to unwrap.
     */
    expect(conversion.body).toContain(
      'https://www.google.com/url?q=https://example.invalid/status',
    );
    expect(conversion.body).toContain(
      'https://www.google.com/url?q=https://docs.google.com/document/d/doc-one/edit',
    );
    expect(conversion.body).toContain('https://example.invalid/plain');
  });
});

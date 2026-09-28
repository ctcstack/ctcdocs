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

  it('publishes an image without alt text with an empty alt, and counts it', async () => {
    const assets = [{ path: 'images/image1.png', bytes: pixel }];
    const result = convertHtmlArchive(
      await fixtureEntries('image-descriptions.html', assets),
      options,
    );
    const image = '../../../assets/generated/synthetic-document/image-001.png';

    // Blank, whitespace, missing, and inside a table; the removed one is not.
    expect(result.undescribedImages).toBe(4);
    expect(result.body).toContain(`![Synthetic pixel, described](${image})`);
    expect(result.body.split(`![](${image})`)).toHaveLength(4);
    expect(result.body).toContain(`<img alt="" src="${image}">`);
    expect(result.body).not.toContain('Synthetic document');
    expect(result.warnings).toContain('removed_unsafe_image');

    const described = convertHtmlArchive(
      await fixtureEntries('duplicate-image.html', assets),
      options,
    );
    expect(described.undescribedImages).toBe(0);
  });

  it('takes the title of an image as its alt text when it has no other', async () => {
    const result = convertHtmlArchive(
      await fixtureEntries('google-image-export.html', [
        { path: 'images/image1.png', bytes: pixel },
      ]),
      options,
    );
    const image = '../../../assets/generated/synthetic-document/image-001.png';

    expect(result.body).toContain(
      `![Synthetic chart, described](${image} "Synthetic title")`,
    );
    // The title is the description, said once.
    expect(result.body).toContain(`![Synthetic title only](${image})\n`);
    expect(result.body).toContain(`\n![](${image})\n`);
    // A blank title is not carried into the page.
    expect(result.body).toContain(`<img alt="" src="${image}">`);
    expect(result.undescribedImages).toBe(2);
  });

  it('counts the images Google crops, and publishes them as before', async () => {
    const assets = [{ path: 'images/image1.png', bytes: pixel }];
    const result = convertHtmlArchive(
      await fixtureEntries('google-image-crop.html', assets),
      options,
    );
    const image = '../../../assets/generated/synthetic-document/image-001.png';

    expect(result.croppedImages).toBe(2);
    for (const alt of [
      'Uncropped',
      'Cropped at the right and the bottom',
      'Cropped at the top',
      'Not framed',
    ]) {
      expect(result.body).toContain(`![${alt}](${image})`);
    }

    const uncropped = convertHtmlArchive(
      await fixtureEntries('google-image-export.html', assets),
      options,
    );
    expect(uncropped.croppedImages).toBe(0);
  });

  it('publishes a heading that holds only an image as a paragraph', async () => {
    const result = convertHtmlArchive(
      await fixtureEntries('image-heading.html', [
        { path: 'images/image1.png', bytes: pixel },
      ]),
      options,
    );
    const image = '../../../assets/generated/synthetic-document/image-001.png';

    expect(result.body.startsWith(`![](${image})\n`)).toBe(true);
    expect(result.body).toContain(`### Setup ![Gear icon](${image})`);
    // An image says nothing to the summary of the page; the first words do.
    expect(result.description).toBe(
      'A heading style applied to a line that holds only a picture.',
    );
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

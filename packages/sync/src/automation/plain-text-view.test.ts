import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { plainTextView, urlTokens } from './plain-text-view.js';

/*
 * Every value below is synthetic. Each example has the shape the converter
 * writes around a value someone typed into a document, which is the shape the
 * scanner's generic rule cannot see through. The values are assembled from
 * parts so that this file, which the repository's own scan reads, does not
 * look like it holds credentials.
 */
const part = (...pieces: string[]) => pieces.join('');
const HEX_KEY = part(
  '3f9c2a7b1e8d4c6f',
  '0a5b9e2d7c1f4a8b',
  '6e3d9c0f2a7b5e1d',
  '8c4f6a0b3e9d2c7f',
);
const TOKEN = part('XRbTq', 'LmV7cWd');
const GATEWAY_ID = part('D7A91', '3550842');
const CELL_TOKEN = part('A1b2C3', 'd4E5f6');
const LINK_SECRET = part('Z9y8X7', 'w6V5u4');
const SIGNATURE = part('Q1w2E3', 'r4T5y6');

const lineCount = (text: string) => text.split('\n').length;

describe('the plain-text view of generated Markdown', () => {
  it('drops emphasis markers, so a value ends where its text does', () => {
    const view = plainTextView(`**API Key:** ${HEX_KEY}\n`);

    expect(view.split('\n')[0]).toBe(`API Key: ${HEX_KEY}`);
  });

  it('writes an autolinked URL, and each query parameter, on the URL’s line', () => {
    const markdown = [
      `0 0 \\* \\* \\* /usr/bin/curl -fsS "<https://leads.example.test/api/restore.php?token=${TOKEN}>" > /dev/null`,
      '',
    ].join('\n');

    const line = plainTextView(markdown).split('\n')[0] ?? '';

    expect(line).toContain('0 0 * * * /usr/bin/curl');
    expect(line).toContain(
      ` https://leads.example.test/api/restore.php?token=${TOKEN} `,
    );
    expect(line).toContain(` token=${TOKEN} `);
    expect(line).toContain('> /dev/null');
  });

  it('undoes the escapes the converter leaves inside an autolink', () => {
    const view = plainTextView(
      `<https://lead.example.test/gateway?API\\_ID=${GATEWAY_ID}&ref=x>\n`,
    );

    expect(view).toContain(` API_ID=${GATEWAY_ID} `);
    expect(view).not.toContain('\\_');
  });

  it('keeps every piece of text on the line it came from', () => {
    const markdown = [
      '---',
      'title: Example',
      '---',
      '',
      '# Heading',
      '',
      'A paragraph that',
      'wraps onto a second line with `code`.',
      '',
      '| Name | Value |',
      '| ---- | ----- |',
      `| key  | ${HEX_KEY} |`,
      '',
      '```php',
      `$key = "${HEX_KEY}";`,
      '```',
      '',
      '    indented code',
      '',
      `<table><tr><td>Token: ${CELL_TOKEN}</td></tr>`,
      `<tr><td><a href="https://example.test/?secret=${LINK_SECRET}">link</a></td></tr></table>`,
      '',
      `![diagram](https://example.test/image.png?sig=${SIGNATURE})`,
      '',
    ].join('\n');

    const view = plainTextView(markdown);
    const lines = view.split('\n');

    expect(lineCount(view)).toBe(lineCount(markdown));
    expect(lines[6]).toBe('A paragraph that');
    expect(lines[7]).toBe('wraps onto a second line with code.');
    expect(lines[11]).toContain(HEX_KEY);
    expect(lines[14]).toBe(`$key = "${HEX_KEY}";`);
    expect(lines[17]).toBe('indented code');
    expect(lines[19]).toBe(`Token: ${CELL_TOKEN}`);
    expect(lines[20]).toContain(` secret=${LINK_SECRET} `);
    expect(lines[22]).toContain(` sig=${SIGNATURE} `);
    expect(lines[22]).toContain('diagram');
  });

  it('keeps HTML inside a list item on its lines, despite the indent', () => {
    const markdown = [
      '- item',
      '',
      '  <table>',
      '  <tr>',
      '  <td>a</td>',
      '  </tr>',
      '  <tr>',
      '  <td>b</td>',
      '  </tr>',
      '  <tr>',
      `  <td>Token: ${CELL_TOKEN}</td>`,
      '  </tr>',
      '  </table>',
      '',
    ].join('\n');

    const lines = plainTextView(markdown).split('\n');

    expect(lines[10]).toBe(`Token: ${CELL_TOKEN}`);
    expect(lines[4]).toBe('a');
    expect(lines[7]).toBe('b');
  });

  it('keeps HTML inside a quote on its lines', () => {
    const markdown = [
      '> <div>',
      '> one',
      '> two',
      `> Token: ${CELL_TOKEN}`,
      '> </div>',
      '',
    ].join('\n');

    expect(plainTextView(markdown).split('\n')[3]).toBe(`Token: ${CELL_TOKEN}`);
  });

  it('writes a link’s URL on the line it is on when the text wraps', () => {
    const lines = plainTextView(
      `Text [a link that\nwraps](https://example.test/?token=${TOKEN}) end.\n`,
    ).split('\n');

    expect(lines[0]).not.toContain(TOKEN);
    expect(lines[1]).toContain(` token=${TOKEN} `);
  });

  it('writes an attribute’s URL on the attribute’s line', () => {
    const lines = plainTextView(
      `<a\n  class="x"\n  href="https://example.test/?secret=${LINK_SECRET}">link</a>\n`,
    ).split('\n');

    expect(lines[0]).not.toContain(LINK_SECRET);
    expect(lines[2]).toContain(` secret=${LINK_SECRET} `);
  });

  it('keeps table cells apart', () => {
    const view = plainTextView(
      `| Name | Value |\n| --- | --- |\n| Password | ${CELL_TOKEN} |\n`,
    );

    expect(view.split('\n')).toEqual([
      'Name | Value',
      '',
      `Password | ${CELL_TOKEN}`,
      '',
    ]);
  });

  it('keeps a decoded line break on the line of its reference', () => {
    const lines = plainTextView(
      `<p>one&#10;Token: ${CELL_TOKEN}</p>\n\nnext\n`,
    ).split('\n');

    expect(lines[0]).toBe(`one Token: ${CELL_TOKEN}`);
    expect(lines[2]).toBe('next');
  });

  it('leaves out the resource key Drive writes into its own links', () => {
    const resourceKey = part('0-Xy7Qw2Er9', 'Ty4Ui1Op3As');
    const drive = `https://drive.google.com/file/d/abc/view?resourcekey=${resourceKey}&usp=sharing`;

    expect(urlTokens(drive)).toEqual([
      'https://drive.google.com/file/d/abc/view?usp=sharing',
      'usp=sharing',
    ]);
    expect(
      urlTokens(`https://example.test/view?resourcekey=${resourceKey}`),
    ).toContain(`resourcekey=${resourceKey}`);
  });

  it('decodes entities in HTML text', () => {
    expect(plainTextView(`<p>key&#61;${CELL_TOKEN}</p>\n`)).toContain(
      `key=${CELL_TOKEN}`,
    );
  });

  it('leaves a URL it cannot parse as it is', () => {
    expect(urlTokens('../relative/page.md?x=1')).toEqual([
      '../relative/page.md?x=1',
    ]);
  });

  it('never changes the line count, whatever the Markdown', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 400 }), (markdown) => {
        expect(lineCount(plainTextView(markdown))).toBe(lineCount(markdown));
      }),
    );
  });
});

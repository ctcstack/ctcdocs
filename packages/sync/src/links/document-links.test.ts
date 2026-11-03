import { describe, expect, it } from 'vitest';

import { documentLinks } from './document-links.js';

const origins = ['https://docs.example.com'];

describe('documentLinks', () => {
  it('reads Google files, permanent links and site addresses', () => {
    const body = [
      '[Doc](https://docs.google.com/document/d/doc-beta/edit#heading=h.x)',
      '[File](https://drive.google.com/file/d/file-pdf/view)',
      '[Open](https://drive.google.com/open?id=doc-open)',
      '[Page](/d/abc123)',
      '[Absolute](https://docs.example.com/team/guide/)',
      '[Elsewhere](https://example.org/team/guide/)',
      '<a href="https://docs.google.com/spreadsheets/d/sheet-one/edit">Sheet</a>',
    ].join('\n\n');

    expect(documentLinks(body, origins)).toEqual([
      { kind: 'address', path: 'team/guide' },
      { kind: 'google', fileId: 'doc-beta', typed: true },
      { kind: 'google', fileId: 'doc-open', typed: false },
      { kind: 'google', fileId: 'file-pdf', typed: true },
      { kind: 'google', fileId: 'sheet-one', typed: true },
      { kind: 'permanent', shortId: 'abc123' },
    ]);
  });

  it('reads a Google redirect as the link it wraps', () => {
    const wrapped = `https://www.google.com/url?q=${encodeURIComponent(
      'https://docs.google.com/document/d/doc-beta/edit',
    )}`;

    expect(documentLinks(`[Doc](${wrapped})`, origins)).toEqual([
      { kind: 'google', fileId: 'doc-beta', typed: true },
    ]);
  });

  it('lists each target once', () => {
    const body = '[One](/d/abc123) and [two](/d/abc123#part).';

    expect(documentLinks(body, origins)).toEqual([
      { kind: 'permanent', shortId: 'abc123' },
    ]);
  });

  it('reads a Drive download address as the file it downloads', () => {
    const body = [
      '[One](https://drive.google.com/uc?export=download&id=zip-one)',
      '[Two](https://drive.usercontent.google.com/download?id=zip-two&export=download)',
      '[None](https://drive.google.com/uc?export=download)',
    ].join('\n\n');

    expect(documentLinks(body, origins)).toEqual([
      { kind: 'download', fileId: 'zip-one' },
      { kind: 'download', fileId: 'zip-two' },
    ]);
  });

  it('ignores links that lead outside the corpus', () => {
    expect(
      documentLinks(
        '[A](https://example.org/) [B](mailto:a@b.c) [C](#x)',
        origins,
      ),
    ).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';

import { rewriteInternalGoogleLinks } from './rewrite-internal-links.js';

const slugs = new Map([
  ['doc-one', 'engineering/architecture'],
  ['doc-two', 'operations/runbook'],
]);

describe('internal Google link rewriting', () => {
  it('rewrites supported Docs and Drive URLs through the complete slug map', () => {
    const result = rewriteInternalGoogleLinks(
      [
        '[Edit](https://docs.google.com/document/d/doc-one/edit)',
        '[View](https://docs.google.com/document/d/doc-two/view#readable-anchor)',
        '[Open](https://drive.google.com/open?id=doc-one)',
      ].join('\n\n'),
      slugs,
    );

    expect(result.body).toContain('(/engineering/architecture/)');
    expect(result.body).toContain('(/operations/runbook/#readable-anchor)');
    expect(result.warnings).toEqual([]);
  });

  it('leaves external-corpus Google documents and unrelated links unchanged', () => {
    const input = [
      '[Outside](https://docs.google.com/document/d/outside/edit)',
      '[External](https://example.invalid/path)',
    ].join('\n\n');

    expect(rewriteInternalGoogleLinks(input, slugs).body).toBe(`${input}\n`);
  });

  it('drops Google-specific and unreadable fragments with one warning', () => {
    const result = rewriteInternalGoogleLinks(
      [
        '[Heading](https://docs.google.com/document/d/doc-one/edit#heading=h.synthetic)',
        '[Bookmark](https://drive.google.com/open?id=doc-two#bookmark=id.synthetic)',
        '[Unreadable](https://docs.google.com/document/d/doc-one/view#bad%20anchor)',
      ].join('\n\n'),
      slugs,
    );

    expect(result.body).not.toContain('#heading=');
    expect(result.body).not.toContain('#bookmark=');
    expect(result.body).not.toContain('#bad');
    expect(result.warnings).toEqual(['link:removed_google_anchor']);
  });

  it('rewrites links inside sanitized complex-table HTML', () => {
    const result = rewriteInternalGoogleLinks(
      '<table><tbody><tr><td><a href="https://docs.google.com/document/d/doc-one/edit">Architecture</a></td></tr></tbody></table>\n',
      slugs,
    );

    expect(result.body).toContain('href="/engineering/architecture/"');
  });
});

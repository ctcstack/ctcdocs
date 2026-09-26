import { describe, expect, it } from 'vitest';

import {
  rewriteInternalGoogleLinks,
  type InternalLinkTargets,
} from './rewrite-internal-links.js';

const slugs: InternalLinkTargets = {
  shortIds: new Map([
    ['doc-one', 'a1b2c3'],
    ['doc-two', 'd4e5f6'],
    ['folder-ops', '0f0f0f'],
  ]),
  addressOwners: new Map([
    ['engineering/architecture', 'doc-one'],
    ['operations/runbook', 'doc-two'],
    ['operations', 'folder-ops'],
    ['engineering/old-architecture', 'doc-one'],
  ]),
  siteOrigins: ['https://docs.example.com'],
};

describe('internal Google link rewriting', () => {
  it('writes supported Docs and Drive URLs as permanent links', () => {
    const result = rewriteInternalGoogleLinks(
      [
        '[Edit](https://docs.google.com/document/d/doc-one/edit)',
        '[View](https://docs.google.com/document/d/doc-two/view#readable-anchor)',
        '[Open](https://drive.google.com/open?id=doc-one)',
      ].join('\n\n'),
      slugs,
    );

    expect(result.body).toContain('(/d/a1b2c3/)');
    expect(result.body).toContain('(/d/d4e5f6/#readable-anchor)');
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

    expect(result.body).toContain('href="/d/a1b2c3/"');
  });

  it('unwraps the redirect Google puts in front of every exported link', () => {
    const result = rewriteInternalGoogleLinks(
      [
        '[Status](https://www.google.com/url?q=https://example.invalid/status&sa=D&source=editors&ust=1785672326246866&usg=AOvVaw0QCl5E0Hz3hnK4fpFNABUi)',
        '[Architecture](https://www.google.com/url?q=https://docs.google.com/document/d/doc-one/edit&sa=D&source=editors&ust=1785672326251648&usg=AOvVaw2f78DId6vaoPYUibGTHDyR)',
        '[Unmanaged](https://www.google.com/url?q=https://docs.google.com/document/d/outside/edit&sa=D&source=editors&ust=1785672326251999&usg=AOvVaw3T1Tt1D)',
      ].join('\n\n'),
      slugs,
    );

    // The reader reaches the target, not Google.
    expect(result.body).toContain('(https://example.invalid/status)');
    // A wrapped link between two documents in this corpus becomes a site link.
    expect(result.body).toContain('(/d/a1b2c3/)');
    // A document outside the corpus keeps its own address, unwrapped.
    expect(result.body).toContain(
      '(https://docs.google.com/document/d/outside/edit)',
    );
    expect(result.body).not.toContain('google.com/url');
  });

  it('produces the same body from two exports of the same document', () => {
    const wrapped = (timestamp: string, signature: string) =>
      `[Status](https://www.google.com/url?q=https://example.invalid/status&sa=D&source=editors&ust=${timestamp}&usg=${signature})`;

    expect(
      rewriteInternalGoogleLinks(wrapped('1785672326', 'AOvVaw0Q'), slugs),
    ).toEqual(
      rewriteInternalGoogleLinks(wrapped('1785672708', 'AOvVaw1D'), slugs),
    );
  });

  it('leaves a wrapper alone when its target is not a safe link', () => {
    const input =
      '[Hostile](https://www.google.com/url?q=javascript:alert\\(1\\)&sa=D&source=editors&ust=1785672326252111&usg=AOvVaw1o)';

    const result = rewriteInternalGoogleLinks(input, slugs);

    // The wrapper survives as an ordinary HTTPS link; what must not happen is
    // a link whose destination is the hostile scheme. The target stays where
    // it was — inside a query string — rather than becoming somewhere a reader
    // can be sent.
    expect(result.body).toContain('https://www.google.com/url?q=javascript');
    expect(result.body).not.toContain('](javascript:');
  });

  it('unwraps a redirect inside inline HTML as well as a Markdown link', () => {
    const result = rewriteInternalGoogleLinks(
      '<p><a href="https://www.google.com/url?q=https://docs.google.com/document/d/doc-two/edit&amp;sa=D&amp;usg=AOvVaw2W">Runbook</a></p>',
      slugs,
    );

    expect(result.body).toContain('href="/d/d4e5f6/"');
  });

  it('ignores a redirect-shaped URL on a host that is not Google', () => {
    const input =
      '[Elsewhere](https://redirect.invalid/url?q=https://example.invalid/target)';

    expect(rewriteInternalGoogleLinks(input, slugs).body).toBe(`${input}\n`);
  });

  it('writes a pasted site address as the permanent link of what it names', () => {
    const result = rewriteInternalGoogleLinks(
      [
        '[Relative](/engineering/architecture/#setup)',
        '[Absolute](https://docs.example.com/operations/runbook/)',
        '[Section](/operations/)',
        '[Earlier address](/engineering/old-architecture/)',
        '[Permanent](https://docs.example.com/d/d4e5f6/)',
      ].join('\n\n'),
      slugs,
    );

    expect(result.body).toContain('[Relative](/d/a1b2c3/#setup)');
    expect(result.body).toContain('[Absolute](/d/d4e5f6/)');
    expect(result.body).toContain('[Section](/d/0f0f0f/)');
    expect(result.body).toContain('[Earlier address](/d/a1b2c3/)');
    expect(result.body).toContain('[Permanent](/d/d4e5f6/)');
  });

  it('leaves addresses it cannot attribute where they point', () => {
    const input = [
      '[Unknown page](/nowhere/)',
      '[Unknown permanent link](/d/ffffff/)',
      '[Another site](https://elsewhere.example.com/engineering/architecture/)',
      '[Relative path](engineering/architecture/)',
      '[Protocol-relative](//docs.example.com/operations/runbook/)',
    ].join('\n\n');

    expect(rewriteInternalGoogleLinks(input, slugs).body).toBe(`${input}\n`);
  });
});

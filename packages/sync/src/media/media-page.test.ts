import { describe, expect, it } from 'vitest';

import type { DriveItem } from '../google/drive-types.js';
import {
  formatDuration,
  mediaChecksum,
  mediaFacts,
  mediaPage,
} from './media-page.js';

function video(extra: Partial<DriveItem> = {}): DriveItem {
  return {
    id: 'video-one',
    name: 'Demo.mov',
    mimeType: 'video/quicktime',
    parents: ['team'],
    modifiedTime: '2026-01-01T00:00:00.000Z',
    createdTime: '2026-01-01T00:00:00.000Z',
    trashed: false,
    ...extra,
  };
}

describe('formatDuration', () => {
  it.each([
    [45, '45 s'],
    [60, '1 min'],
    [252, '4 min 12 s'],
    [3600, '1 h'],
    [3720, '1 h 2 min'],
  ])('writes %i seconds as %s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });
});

describe('mediaFacts', () => {
  it('records what Drive reports, and null for the rest', () => {
    expect(
      mediaFacts(
        video({
          videoMediaMetadata: { width: 1280, height: 720, durationMillis: 400 },
        }),
      ),
    ).toEqual({
      kind: 'video',
      vids: false,
      seconds: 1,
      width: 1280,
      height: 720,
    });
    expect(mediaFacts(video({ mimeType: 'audio/mpeg' }))).toEqual({
      kind: 'audio',
      vids: false,
      seconds: null,
      width: null,
      height: null,
    });
    // Drive reports zeros for a video it has not processed.
    expect(
      mediaFacts(
        video({
          videoMediaMetadata: { width: 0, height: 0, durationMillis: 0 },
        }),
      ),
    ).toEqual({
      kind: 'video',
      vids: false,
      seconds: null,
      width: null,
      height: null,
    });
    expect(
      mediaFacts(video({ mimeType: 'application/vnd.google-apps.vid' })).vids,
    ).toBe(true);
  });

  it('refuses a file that is not a recording', () => {
    expect(() => mediaFacts(video({ mimeType: 'application/pdf' }))).toThrow();
  });
});

describe('mediaPage', () => {
  it('keeps a hostile description literal', () => {
    const markdown = mediaPage(
      video({
        description:
          '<script>alert(1)</script>\n# Not a heading\n[click](javascript:alert(1))\n\n   ',
      }),
    );
    expect(markdown.body).toBe(
      [
        'A video. It plays in Google Drive.',
        '',
        '\\<script>alert(1)\\</script>',
        '',
        '\\# Not a heading',
        '',
        '\\[click]\\(javascript:alert(1))',
        '',
      ].join('\n'),
    );
    expect(markdown.description).toBe('<script>alert(1)</script>');
  });

  it('links web and mail addresses as GFM finds them, and nothing else', () => {
    expect(
      mediaPage(
        video({
          description:
            'See https://example.com/a*b_c?x=1 or www.example.com, ask team@example.com, not javascript:alert(1)',
        }),
      ).body,
    ).toBe(
      [
        'A video. It plays in Google Drive.',
        '',
        'See <https://example.com/a*b_c?x=1> or [www.example.com](http://www.example.com), ask <team@example.com>, not javascript:alert(1)',
        '',
      ].join('\n'),
    );
  });

  it('says nothing more than the facts without a description', () => {
    const page = mediaPage(video({ description: ' \n ' }));
    expect(page.body).toBe('A video. It plays in Google Drive.\n');
    expect(page.description).toBeUndefined();
    expect(page.checksum).toBe(mediaChecksum(video({ description: ' \n ' })));
  });
});

describe('mediaChecksum', () => {
  it('changes with what the page is written from, and nothing else', () => {
    const base = mediaChecksum(video({ description: 'One' }));
    expect(
      mediaChecksum(
        video({ description: 'One', modifiedTime: '2026-02-01T00:00:00.000Z' }),
      ),
    ).toBe(base);
    expect(mediaChecksum(video({ description: 'Two' }))).not.toBe(base);
    expect(
      mediaChecksum(
        video({
          description: 'One',
          videoMediaMetadata: { durationMillis: 5000 },
        }),
      ),
    ).not.toBe(base);
  });
});

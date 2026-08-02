import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { UnsafeAssetError, validateImageAsset } from './validate-asset.js';

const fixtureDirectory = new URL('../../fixtures/svg/', import.meta.url);

describe('image asset validation', () => {
  it.each([
    ['image.png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'png'],
    ['image.jpg', [0xff, 0xd8, 0xff], 'jpg'],
    ['image.gif', [...Buffer.from('GIF89a')], 'gif'],
    ['image.webp', [...Buffer.from('RIFF0000WEBP')], 'webp'],
  ])('accepts a valid %s signature', (path, bytes, extension) => {
    expect(validateImageAsset(path, Uint8Array.from(bytes)).extension).toBe(
      extension,
    );
  });

  it('accepts and deterministically normalizes a safe SVG', async () => {
    const input = await readFile(new URL('safe.svg', fixtureDirectory));
    const first = validateImageAsset('drawing.svg', input);
    const second = validateImageAsset('drawing.svg', first.bytes);

    expect(first.extension).toBe('svg');
    expect(new TextDecoder().decode(first.bytes)).toContain(
      'fill="url(#gradient)"',
    );
    expect(second.bytes).toEqual(first.bytes);
  });

  it('rejects active SVG content and mismatched extensions', async () => {
    const malicious = await readFile(
      new URL('malicious.svg', fixtureDirectory),
    );
    expect(() => validateImageAsset('drawing.svg', malicious)).toThrow(
      UnsafeAssetError,
    );
    expect(() =>
      validateImageAsset('image.png', new TextEncoder().encode('<svg></svg>')),
    ).toThrow('MIME type');
  });
});

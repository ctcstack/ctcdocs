import { describe, expect, it } from 'vitest';

import { describeFileType, UNPUBLISHED_REASONS } from './unpublished.js';

describe('describeFileType', () => {
  it.each([
    ['application/vnd.google-apps.spreadsheet', undefined, 'Google Sheets'],
    ['application/vnd.google-apps.presentation', undefined, 'Google Slides'],
    [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      undefined,
      'Word document',
    ],
    ['image/png', undefined, 'Image (PNG)'],
    ['image/svg+xml', undefined, 'Image (SVG)'],
    ['video/quicktime', undefined, 'Video (QUICKTIME)'],
    [
      'application/vnd.google-apps.shortcut',
      'application/vnd.google-apps.document',
      'Shortcut to Google Docs',
    ],
    ['application/vnd.google-apps.shortcut', undefined, 'Shortcut'],
    ['application/x-unknown', undefined, 'application/x-unknown'],
  ])('describes %s as %s', (mimeType, target, expected) => {
    expect(describeFileType(mimeType, target)).toBe(expected);
  });
});

describe('UNPUBLISHED_REASONS', () => {
  it('has one entry per code, each with an instruction', () => {
    const codes = UNPUBLISHED_REASONS.map((reason) => reason.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const reason of UNPUBLISHED_REASONS) {
      expect(reason.title.length).toBeGreaterThan(0);
      expect(reason.instruction.length).toBeGreaterThan(0);
    }
  });
});

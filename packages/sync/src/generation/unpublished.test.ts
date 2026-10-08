import { describe, expect, it } from 'vitest';

import {
  describeFileType,
  driveUrl,
  UNPUBLISHED_REASONS,
  unsupportedFileReason,
} from './unpublished.js';

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

describe('unsupportedFileReason', () => {
  it.each([
    [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Guide.docx',
      'word-file',
    ],
    ['text/plain', 'Notes.txt', 'word-file'],
    ['application/vnd.google-apps.presentation', 'Deck', 'presentation-file'],
    ['application/vnd.google-apps.spreadsheet', 'Budget', 'spreadsheet-file'],
    ['text/csv', 'Import.csv', 'spreadsheet-file'],
    ['image/jpeg', 'Map.png', 'image-file'],
    ['application/zip', 'Audit.zip', 'archive-file'],
    // Drive does not know draw.io, so the name decides.
    ['application/octet-stream', 'Flow.drawio', 'diagram-file'],
    ['application/vnd.google-apps.drawing', 'Sketch', 'diagram-file'],
    ['application/vnd.google-apps.form', 'Survey', 'unsupported-type'],
  ])('puts %s (%s) under %s', (mimeType, name, expected) => {
    expect(unsupportedFileReason(mimeType, name)).toBe(expected);
  });
});

describe('driveUrl', () => {
  const selected = (webViewLink?: string) => ({
    item: {
      id: 'file-one',
      name: 'Guide.docx',
      mimeType: 'application/msword',
      parents: ['team'],
      modifiedTime: '2026-01-01T00:00:00.000Z',
      createdTime: '2026-01-01T00:00:00.000Z',
      trashed: false,
      ...(webViewLink ? { webViewLink } : {}),
    },
    parentId: 'team',
    path: ['Published', 'Team', 'Guide.docx'],
  });

  it('drops the owner and the link source Drive adds, and keeps the rest', () => {
    expect(
      driveUrl(
        selected(
          'https://docs.google.com/document/d/file-one/edit?usp=drivesdk&ouid=1234567890&rtpof=true&sd=true',
        ),
      ),
    ).toBe(
      'https://docs.google.com/document/d/file-one/edit?rtpof=true&sd=true',
    );
    expect(
      driveUrl(
        selected('https://drive.google.com/file/d/file-one/view?usp=drivesdk'),
      ),
    ).toBe('https://drive.google.com/file/d/file-one/view');
  });

  it('falls back to the file ID', () => {
    expect(driveUrl(selected())).toBe(
      'https://drive.google.com/open?id=file-one',
    );
  });
});

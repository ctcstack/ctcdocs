import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { recordedHeldDocuments, syncReportSchema } from './sync-report.js';

const fixtureReport = new URL(
  '../../../../fixtures/project/data/latest-sync-report.json',
  import.meta.url,
);

describe('recordedHeldDocuments', () => {
  it('reads what an earlier version held back, whatever notes it wrote', async () => {
    const report = JSON.parse(await readFile(fixtureReport, 'utf8')) as {
      unpublished: unknown[];
      noteKinds: unknown[];
      notes: unknown[];
    };
    report.unpublished.push({
      id: 'held',
      name: 'Held back',
      folderPath: ['Team'],
      type: 'Google Docs',
      mimeType: 'application/vnd.google-apps.document',
      status: 'out-of-date',
      reason: 'export-too-large',
      sourceUrl: 'https://docs.google.com/document/d/held/edit',
      lastEditedBy: null,
    });
    // A note kind 0.12.0 wrote and this version no longer knows.
    report.noteKinds.push({
      code: 'image-cropped',
      title: 'An image is cropped in Google Docs',
      action: 'Check what was cropped away',
      instruction: 'Retired.',
    });
    report.notes.push({
      id: 'held',
      name: 'Held back',
      folderPath: ['Team'],
      type: 'Google Docs',
      sourceUrl: 'https://docs.google.com/document/d/held/edit',
      lastEditedBy: null,
      note: 'image-cropped',
      detail: '1 image',
    });

    expect(recordedHeldDocuments(JSON.stringify(report)).get('held')).toEqual({
      reason: 'export-too-large',
      outOfDate: true,
    });
  });

  it('reads a report that lists video as not published, as before ADR-047', async () => {
    const report = JSON.parse(await readFile(fixtureReport, 'utf8')) as {
      reasons: unknown[];
      unpublished: unknown[];
    };
    report.reasons.push({
      code: 'media-file',
      title: 'Video and audio',
      action: 'Link from a document',
      instruction: 'Retired.',
    });
    report.unpublished.push(
      {
        id: 'old-video',
        name: 'Demo.mov',
        folderPath: ['Team'],
        type: 'Video (QUICKTIME)',
        mimeType: 'video/quicktime',
        status: 'not-published',
        reason: 'media-file',
        sourceUrl: 'https://drive.google.com/file/d/old-video/view',
        lastEditedBy: null,
      },
      {
        id: 'held',
        name: 'Held back',
        folderPath: ['Team'],
        type: 'Google Docs',
        mimeType: 'application/vnd.google-apps.document',
        status: 'out-of-date',
        reason: 'export-too-large',
        sourceUrl: 'https://docs.google.com/document/d/held/edit',
        lastEditedBy: null,
      },
    );

    // Validation passes between the upgrade and the next sync.
    expect(syncReportSchema.safeParse(report).success).toBe(true);
    expect(recordedHeldDocuments(JSON.stringify(report)).get('held')).toEqual({
      reason: 'export-too-large',
      outOfDate: true,
    });
  });
});

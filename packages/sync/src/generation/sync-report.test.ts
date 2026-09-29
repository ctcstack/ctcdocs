import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { recordedHeldDocuments } from './sync-report.js';

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
});

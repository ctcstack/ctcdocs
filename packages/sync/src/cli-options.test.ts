import { describe, expect, it } from 'vitest';

import { CliUsageError, parseCliOptions } from './cli-options.js';

describe('CLI option parsing', () => {
  it('parses validation and Markdown sync options', () => {
    expect(parseCliOptions(['validate'])).toEqual({ command: 'validate' });
    expect(parseCliOptions(['sync', '--dry-run', '--json'])).toEqual({
      command: 'sync',
      dryRun: true,
      full: false,
      inventoryOnly: false,
      json: true,
    });
    expect(parseCliOptions(['sync', '--dry-run', '--', '--json'])).toEqual({
      command: 'sync',
      dryRun: true,
      full: false,
      inventoryOnly: false,
      json: true,
    });
    expect(parseCliOptions(['sync', '--full'])).toEqual({
      command: 'sync',
      dryRun: false,
      full: true,
      inventoryOnly: false,
      json: false,
    });
    expect(parseCliOptions(['sync', '--file', 'doc-id'])).toEqual({
      command: 'sync',
      dryRun: false,
      fileId: 'doc-id',
      full: false,
      inventoryOnly: false,
      json: false,
    });
    expect(parseCliOptions(['sync', '--reseed-slug', 'doc-id'])).toEqual({
      command: 'sync',
      dryRun: false,
      full: false,
      inventoryOnly: false,
      json: false,
      reseedSlugFileId: 'doc-id',
    });
    expect(parseCliOptions(['sync', '--dry-run', '--inventory-only'])).toEqual({
      command: 'sync',
      dryRun: true,
      full: false,
      inventoryOnly: true,
      json: false,
    });
  });

  it('rejects unknown commands and flags', () => {
    expect(parseCliOptions(['sync'])).toEqual({
      command: 'sync',
      dryRun: false,
      full: false,
      inventoryOnly: false,
      json: false,
    });
    expect(() => parseCliOptions(['sync', '--unknown'])).toThrow(CliUsageError);
    expect(() => parseCliOptions(['validate', '--unknown'])).toThrow(
      'does not accept options',
    );
    expect(() => parseCliOptions(['sync', '--inventory-only'])).toThrow(
      'requires --dry-run',
    );
    expect(() =>
      parseCliOptions(['sync', '--dry-run', '--inventory-only', '--full']),
    ).toThrow('cannot be combined');
    expect(() => parseCliOptions(['sync', '--full', '--file', 'one'])).toThrow(
      'cannot be combined',
    );
    expect(() =>
      parseCliOptions(['sync', '--file', 'one', '--file', 'two']),
    ).toThrow('only be provided once');
    expect(() => parseCliOptions(['sync', '--file'])).toThrow(
      'requires a valid Google file ID',
    );
    expect(() => parseCliOptions(['sync', '--file', '../unsafe'])).toThrow(
      'requires a valid Google file ID',
    );
    expect(() =>
      parseCliOptions(['sync', '--file', 'one', '--reseed-slug', 'two']),
    ).toThrow('cannot be combined');
    expect(() => parseCliOptions(['unknown'])).toThrow('Usage:');
  });
});

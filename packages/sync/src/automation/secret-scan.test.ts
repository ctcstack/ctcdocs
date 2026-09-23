import { describe, expect, it } from 'vitest';

import { createEmptyManifest } from '../manifest.js';
import {
  createGoogleFileIdResolver,
  describeSecretFinding,
  GITLEAKS_FINDINGS_EXIT_CODE,
  gitleaksArguments,
  parseGitleaksReport,
  SecretScanError,
} from './secret-scan.js';

/*
 * Stands in for the document text a report carries around a redacted value.
 * Nothing derived from a report may contain it.
 */
const DOCUMENT_TEXT = 'SYNTHETIC-DOCUMENT-TEXT';

function reportEntry(overrides: Record<string, unknown> = {}) {
  return {
    RuleID: 'generic-api-key',
    Description: 'Detected a Generic API Key',
    StartLine: 12,
    EndLine: 12,
    StartColumn: 5,
    EndColumn: 57,
    Match: `${DOCUMENT_TEXT}: "REDACTED"`,
    Secret: 'REDACTED',
    File: 'src/content/docs/_generated/guide/setup.md',
    SymlinkFile: '',
    Commit: '',
    Entropy: 5.2,
    Author: '',
    Email: '',
    Date: '0001-01-01T00:00:00Z',
    Message: '',
    Tags: [],
    Fingerprint:
      'src/content/docs/_generated/guide/setup.md:generic-api-key:12',
    ...overrides,
  };
}

const timestamp = '2026-01-01T00:00:00.000Z';

function manifestWithOneDocument() {
  const manifest = createEmptyManifest('drive-id', 'root-id', timestamp);
  manifest.documents['doc-setup'] = {
    googleFileId: 'doc-setup',
    googleParentId: 'folder-guide',
    googleName: 'Setup',
    displayTitle: 'Setup',
    googleModifiedTime: timestamp,
    sourceUrl: 'https://docs.google.com/document/d/doc-setup/edit',
    stableSlug: 'guide/setup',
    generatedMarkdownPath: 'src/content/docs/_generated/guide/setup.md',
    generatedAssetsDirectory: 'src/assets/generated/doc-setup',
    contentHash: `sha256:${'0'.repeat(64)}`,
    outputHash: `sha256:${'1'.repeat(64)}`,
    lastSuccessfulSyncAt: timestamp,
    exportMode: 'markdown',
    warnings: [],
  };
  manifest.folders['folder-guide'] = {
    googleFolderId: 'folder-guide',
    googleParentId: 'root-id',
    googleName: 'Guide',
    displayLabel: 'Guide',
    sortOrder: null,
    stableSlug: 'guide',
    generatedMarkdownPath: 'src/content/docs/_generated/section-guide.md',
  };
  return manifest;
}

describe('reading a gitleaks report', () => {
  it('keeps only the rule, the file and the line, in a stable order', () => {
    const findings = parseGitleaksReport(
      JSON.stringify([
        reportEntry({ StartLine: 40 }),
        reportEntry({ File: 'data/docs-index.json', StartLine: 3 }),
        reportEntry({ RuleID: 'aws-access-token', StartLine: 40 }),
        reportEntry(),
      ]),
    );

    expect(findings).toEqual([
      { ruleId: 'generic-api-key', path: 'data/docs-index.json', line: 3 },
      {
        ruleId: 'generic-api-key',
        path: 'src/content/docs/_generated/guide/setup.md',
        line: 12,
      },
      {
        ruleId: 'aws-access-token',
        path: 'src/content/docs/_generated/guide/setup.md',
        line: 40,
      },
      {
        ruleId: 'generic-api-key',
        path: 'src/content/docs/_generated/guide/setup.md',
        line: 40,
      },
    ]);
    expect(JSON.stringify(findings)).not.toContain(DOCUMENT_TEXT);
  });

  it('reads an empty report as a clean scan', () => {
    expect(parseGitleaksReport('[]')).toEqual([]);
  });

  it.each([
    ['text that is not JSON', 'leaks found: 1'],
    ['an object instead of a list', '{}'],
    ['an entry without a rule', JSON.stringify([reportEntry({ RuleID: '' })])],
    [
      'a line that is not a number',
      JSON.stringify([reportEntry({ StartLine: '12' })]),
    ],
    [
      'a path that would start a new log line',
      JSON.stringify([reportEntry({ File: 'a.md\n::error::forged' })]),
    ],
  ])('refuses %s rather than pass the scan', (_case, content) => {
    expect(() => parseGitleaksReport(content)).toThrow(SecretScanError);
  });

  it('does not repeat rejected report values in its error', () => {
    expect(() =>
      parseGitleaksReport(
        JSON.stringify([reportEntry({ StartLine: DOCUMENT_TEXT })]),
      ),
    ).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining(DOCUMENT_TEXT),
      }),
    );
  });
});

describe('the gitleaks command line', () => {
  const arguments_ = gitleaksArguments({
    configurationFile: '/project/.gitleaks.toml',
    ignoreDirectory: '/project',
    reportFile: '/tmp/scan/report.json',
  });

  function valueOf(flag: string): string | undefined {
    const index = arguments_.indexOf(flag);
    return index === -1 ? undefined : arguments_[index + 1];
  }

  it('scans the files of the current directory, not a Git diff', () => {
    expect(arguments_[0]).toBe('dir');
    expect(arguments_.at(-1)).toBe('.');
  });

  it('reads the project configuration and ignore file explicitly', () => {
    expect(valueOf('--config')).toBe('/project/.gitleaks.toml');
    expect(valueOf('--gitleaks-ignore-path')).toBe('/project');
  });

  it('redacts, and ignores allow markers written into a document', () => {
    expect(arguments_).toContain('--redact=100');
    expect(arguments_).toContain('--ignore-gitleaks-allow');
    expect(arguments_).not.toContain('--verbose');
    expect(arguments_).not.toContain('-v');
  });

  it('writes a JSON report and tells a finding from a failure', () => {
    expect(valueOf('--report-format')).toBe('json');
    expect(valueOf('--report-path')).toBe('/tmp/scan/report.json');
    expect(valueOf('--exit-code')).toBe(String(GITLEAKS_FINDINGS_EXIT_CODE));
    expect(GITLEAKS_FINDINGS_EXIT_CODE).not.toBe(1);
  });
});

describe('naming the Google file behind a finding', () => {
  const resolveFileId = createGoogleFileIdResolver(manifestWithOneDocument());

  it('maps a document, its assets, and a folder page', () => {
    expect(resolveFileId('src/content/docs/_generated/guide/setup.md')).toBe(
      'doc-setup',
    );
    expect(resolveFileId('src/assets/generated/doc-setup/image-1.svg')).toBe(
      'doc-setup',
    );
    expect(resolveFileId('src/content/docs/_generated/section-guide.md')).toBe(
      'folder-guide',
    );
  });

  it('names no file for shared output or an unknown path', () => {
    expect(resolveFileId('src/generated/sidebar.ts')).toBeUndefined();
    expect(resolveFileId('data/docs-index.json')).toBeUndefined();
    expect(
      resolveFileId('src/assets/generated/doc-setup-2/a.svg'),
    ).toBeUndefined();
  });

  it('names no file when the manifest cannot be read', () => {
    expect(
      createGoogleFileIdResolver({ schemaVersion: 3 })(
        'src/content/docs/_generated/guide/setup.md',
      ),
    ).toBeUndefined();
  });
});

describe('a finding as a log line', () => {
  const finding = {
    ruleId: 'generic-api-key',
    path: 'src/content/docs/_generated/guide/setup.md',
    line: 12,
  };

  it('says where, what matched and which file, and nothing else', () => {
    expect(describeSecretFinding(finding, 'doc-setup')).toBe(
      'rule=generic-api-key path=src/content/docs/_generated/guide/setup.md line=12 fileId=doc-setup',
    );
  });

  it('leaves out a file it cannot name', () => {
    expect(describeSecretFinding(finding, undefined)).toBe(
      'rule=generic-api-key path=src/content/docs/_generated/guide/setup.md line=12',
    );
  });
});

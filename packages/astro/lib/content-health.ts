/**
 * The reports behind the content health page (ADR-024, ADR-025).
 *
 * The sync writes `data/title-report.json` and `data/latest-sync-report.json`;
 * the site only reads them, at build time. The page needs a handful of their
 * fields, typed here rather than imported, so the site does not depend on the
 * sync package.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { findProjectRoot, PROJECT_LAYOUT } from '@ctcstack/ctcdocs-core';

export type HealthSeverity = 'fix' | 'convention' | 'note';

interface HealthCheck {
  code: string;
  severity: HealthSeverity;
  title: string;
  instruction: string;
}

interface HealthIssue {
  check: string;
  text?: string;
  detail?: string;
  headingId?: string;
  tabId?: string;
  related?: { slug: string; title: string };
}

interface HealthDocument {
  id: string;
  slug: string;
  name: string;
  title: string;
  folderPath: string[];
  lastEditedBy: string | null;
  source: unknown;
  issues: HealthIssue[];
}

export interface HealthReport {
  schemaVersion: 2;
  checks: HealthCheck[];
  summary: {
    documents: number;
    inspected: number;
    conforming: number;
    severity: Record<HealthSeverity, number>;
    checks: Record<string, number>;
  };
  documents: HealthDocument[];
}

/** The report, or `undefined` before a sync has written one this page reads. */
export function loadHealthReport(): HealthReport | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      readFileSync(
        resolve(findProjectRoot(), PROJECT_LAYOUT.titleReportFile),
        'utf8',
      ),
    );
  } catch {
    return undefined;
  }
  return typeof parsed === 'object' &&
    parsed !== null &&
    (parsed as { schemaVersion?: unknown }).schemaVersion === 2
    ? (parsed as HealthReport)
    : undefined;
}

/**
 * Opens the document in Google Docs: in the tab and at the paragraph an issue
 * names, when it names them.
 */
export function googleDocsUrl(
  id: string,
  issue?: { headingId?: string; tabId?: string },
): string {
  const tab = issue?.tabId ? `?tab=${encodeURIComponent(issue.tabId)}` : '';
  const heading = issue?.headingId
    ? `#heading=${encodeURIComponent(issue.headingId)}`
    : '';
  return `https://docs.google.com/document/d/${encodeURIComponent(id)}/edit${tab}${heading}`;
}

/** The top-level folder an item is filed under, for the section filter. */
export function sectionOf(item: { folderPath: readonly string[] }): string {
  return item.folderPath[0] ?? 'General';
}

type UnpublishedStatus = 'not-published' | 'out-of-date';

interface UnpublishedReason {
  code: string;
  title: string;
  instruction: string;
}

export interface UnpublishedItem {
  id: string;
  name: string;
  folderPath: string[];
  type: string;
  status: UnpublishedStatus;
  reason: string;
  detail?: string;
  sourceUrl: string;
  lastEditedBy: string | null;
  slug?: string;
  publishedVersion?: string;
}

interface IgnoredFolder {
  id: string;
  name: string;
  folderPath: string[];
  items: number;
}

/** What the last sync left off the site, and why (ADR-025). */
export interface UnpublishedReport {
  reasons: UnpublishedReason[];
  unpublished: UnpublishedItem[];
  ignoredFolders: IgnoredFolder[];
}

/** The list, or `undefined` before a sync has written a report that has one. */
export function loadUnpublishedReport(): UnpublishedReport | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      readFileSync(
        resolve(findProjectRoot(), PROJECT_LAYOUT.syncReportFile),
        'utf8',
      ),
    );
  } catch {
    return undefined;
  }
  return typeof parsed === 'object' &&
    parsed !== null &&
    (parsed as { schemaVersion?: unknown }).schemaVersion === 2
    ? (parsed as UnpublishedReport)
    : undefined;
}

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
  /** Absent from a report written before checks carried one. */
  action?: string;
  instruction: string;
}

export interface HealthIssue {
  check: string;
  text?: string;
  detail?: string;
  headingId?: string;
  tabId?: string;
  related?: { slug: string; title: string };
}

export interface HealthDocument {
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

type UnpublishedStatus = 'not-published' | 'out-of-date' | 'incomplete';

/** A reason or a note kind: what it is, and what to do about it. */
interface CatalogEntry {
  code: string;
  title: string;
  action: string;
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

export interface ReportNote {
  id: string;
  name: string;
  folderPath: string[];
  type: string;
  sourceUrl: string;
  lastEditedBy: string | null;
  slug?: string;
  note: string;
  detail?: string;
}

export interface IgnoredFolder {
  id: string;
  name: string;
  folderPath: string[];
  items: number;
}

/**
 * What the last sync that changed the site recorded about it: what is on it,
 * what is not and why, and what to know (ADR-025, ADR-028).
 */
export interface SyncState {
  generatedAt: string;
  summary: {
    /** `sheets` is absent from a report written before ADR-046. */
    published: { googleDocs: number; pdfs: number; sheets?: number };
    conversion: { markdown: number; html: number };
    notPublished: number;
    outOfDate: number;
    incomplete: number;
    notes: number;
  };
  reasons: CatalogEntry[];
  unpublished: UnpublishedItem[];
  ignoredFolders: IgnoredFolder[];
  noteKinds: CatalogEntry[];
  notes: ReportNote[];
}

/**
 * Where a group's items are, by top-level section, most first, two named:
 * `Handbook 4 · General 1 · +2 more`.
 */
export function whereOf(
  items: ReadonlyArray<{ folderPath: readonly string[] }>,
): string {
  const counts = new Map<string, number>();
  for (const item of items) {
    const section = sectionOf(item);
    counts.set(section, (counts.get(section) ?? 0) + 1);
  }
  const sections = [...counts]
    .sort(
      ([leftName, left], [rightName, right]) =>
        right - left || leftName.localeCompare(rightName, 'en'),
    )
    .map(([name, count]) => `${name} ${count}`);
  return sections.length > 2
    ? `${sections.slice(0, 2).join(' · ')} · +${sections.length - 2} more`
    : sections.join(' · ');
}

/** The state, or `undefined` before a sync has written a report that has it. */
export function loadSyncState(): SyncState | undefined {
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
    (parsed as { schemaVersion?: unknown }).schemaVersion === 3
    ? (parsed as SyncState)
    : undefined;
}

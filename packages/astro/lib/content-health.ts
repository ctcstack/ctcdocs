/**
 * The title report, shaped for the content health page (ADR-024).
 *
 * The sync writes `data/title-report.json`; the site only reads it, at build
 * time. The page needs a handful of its fields, typed here rather than
 * imported, so the site does not depend on the sync package.
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

/** The top-level folder a document is filed under, for the section filter. */
export function sectionOf(document: HealthDocument): string {
  return document.folderPath[0] ?? 'General';
}

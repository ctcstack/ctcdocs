#!/usr/bin/env node

import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

import { ZodError } from 'zod';

import { UnsafeZipError } from './archive/safe-zip.js';
import { GeneratedDiffValidationError } from './automation/generated-diff.js';
import { validateGeneratedDiff } from './automation/validate-generated-diff.js';
import {
  SyncSummaryError,
  writeSyncSummary,
} from './automation/write-sync-summary.js';
import { CliUsageError, parseCliOptions } from './cli-options.js';
import { parseSyncConfiguration } from './config.js';
import { validateRepositoryContent } from './content-validation.js';
import { HtmlArchiveConversionError } from './conversion/html-archive-converter.js';
import {
  createEnvironmentGoogleAccessTokenProvider,
  GoogleAuthenticationConfigurationError,
} from './google/auth.js';
import { GoogleApiError } from './google/google-api-error.js';
import { InventoryGraphError } from './inventory/inventory-graph.js';
import { serializeInventoryReport } from './inventory/inventory-report.js';
import { runInventory } from './inventory/run-inventory.js';
import { MarkdownNormalizationError } from './markdown/normalize-markdown.js';
import { ManifestError } from './manifest.js';
import { AtomicWriteError } from './output/atomic-writer.js';
import { GeneratedOutputValidationError } from './output/validate-generated-output.js';
import { loadSyncContext } from './project-context.js';
import { runBasicMarkdownSync, SyncSelectionError } from './run-sync.js';

/*
 * The command runs inside the project it acts on, wherever that project keeps
 * this package. Everything below is resolved from the root that holds
 * site.config.json rather than from a path relative to this file.
 */
const context = loadSyncContext();
const { repositoryRoot } = context;

function loadLocalEnvironment(): void {
  try {
    loadEnvFile(resolve(repositoryRoot, '.env'));
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
}

function printSyncSummary(
  result: Awaited<ReturnType<typeof runBasicMarkdownSync>>,
  dryRun: boolean,
): void {
  const { summary } = result.report;
  console.log(
    dryRun
      ? 'Google Drive Markdown sync dry-run passed.'
      : 'Google Drive Markdown sync passed.',
  );
  console.log(`Documents added: ${summary.added}`);
  console.log(`Documents changed: ${summary.changed}`);
  console.log(`Documents unchanged: ${summary.unchanged}`);
  console.log(`Documents removed: ${summary.removed}`);
  console.log(`Folders selected: ${summary.folders}`);
  console.log(`Unsupported items selected: ${summary.unsupported}`);
  console.log(`Warnings: ${summary.warnings}`);
  console.log(
    dryRun
      ? `Generated output would change: ${result.outputChanged ? 'yes' : 'no'}`
      : `Generated output changed: ${result.outputChanged ? 'yes' : 'no'}`,
  );
  if (result.slugChange) {
    console.log(`Old URL: /${result.slugChange.oldSlug}/`);
    console.log(`New URL: /${result.slugChange.newSlug}/`);
  }
}

function printInventorySummary(
  result: Awaited<ReturnType<typeof runInventory>>,
): void {
  const { summary } = result.report;
  console.log('Google Drive inventory dry-run passed.');
  console.log(`Items visible: ${summary.allItems}`);
  console.log(`Folders selected: ${summary.folders}`);
  console.log(`Google Docs selected: ${summary.documents}`);
  console.log(`Unsupported items selected: ${summary.unsupported}`);
  console.log(`Ignored items: ${summary.ignored}`);
  console.log(`Warnings: ${summary.warnings}`);
  /*
   * A count alone does not say what to fix. The codes are safe to print here:
   * they name a kind of problem, while the identifiers that would name the
   * documents stay in the JSON report.
   */
  const warningCounts = new Map<string, number>();
  for (const warning of result.report.warnings) {
    warningCounts.set(warning.code, (warningCounts.get(warning.code) ?? 0) + 1);
  }
  for (const [code, count] of [...warningCounts].sort(([left], [right]) =>
    left < right ? -1 : 1,
  )) {
    console.log(`  ${code}: ${count}`);
  }
}

async function main(): Promise<void> {
  loadLocalEnvironment();
  const options = parseCliOptions(process.argv.slice(2));

  if (options.command === 'validate:generated-diff') {
    validateGeneratedDiff(repositoryRoot);
    return;
  }

  if (options.command === 'write:sync-summary') {
    await writeSyncSummary(repositoryRoot);
    return;
  }

  if (options.command === 'validate') {
    const result = await validateRepositoryContent(context);
    if (result.errors.length > 0) {
      for (const error of result.errors) {
        console.error(`ERROR: ${error}`);
      }
      process.exitCode = 1;
      return;
    }

    console.log(
      `Content validation passed (${result.checkedFiles} files checked).`,
    );
    if (!result.hasCorpus) {
      console.log(
        'This project has never synchronized: there is no generated corpus to check yet.',
      );
    }
    return;
  }

  const configuration = parseSyncConfiguration(process.env, context.site);
  const accessTokenProvider = createEnvironmentGoogleAccessTokenProvider(
    process.env,
  );
  if (options.inventoryOnly) {
    const result = await runInventory(
      context,
      configuration,
      accessTokenProvider,
    );
    if (options.json) {
      process.stdout.write(serializeInventoryReport(result.report));
    } else {
      printInventorySummary(result);
    }
    return;
  }
  const dryRun = options.dryRun || configuration.SYNC_DRY_RUN;
  const result = await runBasicMarkdownSync(
    context,
    configuration,
    accessTokenProvider,
    {
      dryRun,
      ...(options.fileId ? { fileId: options.fileId } : {}),
      full: options.full,
      ...(options.reseedSlugFileId
        ? { reseedSlugFileId: options.reseedSlugFileId }
        : {}),
    },
  );

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
  } else {
    printSyncSummary(result, dryRun);
  }
}

try {
  await main();
} catch (error: unknown) {
  if (error instanceof GoogleAuthenticationConfigurationError) {
    console.error(`ERROR [AUTHENTICATION]: ${error.message}`);
    process.exitCode = 2;
  } else if (error instanceof GoogleApiError) {
    const exitCode =
      error.category === 'authentication'
        ? 2
        : error.category === 'permission'
          ? 3
          : 1;
    console.error(
      `ERROR [GOOGLE_${error.category.toUpperCase()}]: status=${error.status ?? 'unavailable'} requestId=${error.requestId}`,
    );
    process.exitCode = exitCode;
  } else if (error instanceof InventoryGraphError) {
    console.error(
      `ERROR [INVENTORY_GRAPH]: ${error.issues.map((issue) => issue.code).join(',')}`,
    );
    process.exitCode = 1;
  } else if (error instanceof MarkdownNormalizationError) {
    console.error(
      `ERROR [MARKDOWN_NORMALIZATION]: ${error.issues.map((issue) => issue.code).join(',')}`,
    );
    process.exitCode = 1;
  } else if (
    error instanceof UnsafeZipError ||
    error instanceof HtmlArchiveConversionError
  ) {
    console.error(`ERROR [CONTENT_CONVERSION]: ${error.message}`);
    process.exitCode = 1;
  } else if (error instanceof GeneratedOutputValidationError) {
    console.error(`ERROR [GENERATED_OUTPUT_VALIDATION]: ${error.message}`);
    process.exitCode = 4;
  } else if (error instanceof SyncSelectionError) {
    console.error(`ERROR [SYNC_SELECTION]: ${error.message}`);
    process.exitCode = 1;
  } else if (error instanceof ManifestError) {
    console.error(`ERROR [MANIFEST]: ${error.message}`);
    process.exitCode = 1;
  } else if (error instanceof AtomicWriteError) {
    console.error(`ERROR [ATOMIC_WRITE]: ${error.message}`);
    process.exitCode = 1;
  } else if (error instanceof ZodError) {
    console.error(
      `ERROR [CONFIGURATION]: ${error.issues.map((issue) => issue.path.join('.') || 'environment').join(',')}`,
    );
    process.exitCode = 1;
  } else if (error instanceof GeneratedDiffValidationError) {
    console.error(`ERROR [GENERATED_DIFF]: ${error.message}`);
    process.exitCode = 1;
  } else if (error instanceof SyncSummaryError) {
    console.error(`ERROR [SYNC_SUMMARY]: ${error.message}`);
    process.exitCode = 1;
  } else if (error instanceof CliUsageError) {
    console.error(`ERROR [USAGE]: ${error.message}`);
    process.exitCode = 1;
  } else {
    console.error('ERROR [UNEXPECTED]: The sync command failed.');
    process.exitCode = 1;
  }
}

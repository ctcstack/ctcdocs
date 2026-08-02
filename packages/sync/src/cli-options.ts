interface ValidateCliOptions {
  command: 'validate';
}

/*
 * The two commands GitHub Actions runs. They take no options: everything they
 * need is the project they are run in, plus the workflow environment. Each is
 * its own type rather than one type with two command values, because a union
 * member narrows by a discriminant only when it holds a single literal.
 */
interface GeneratedDiffCliOptions {
  command: 'validate:generated-diff';
}

interface SyncSummaryCliOptions {
  command: 'write:sync-summary';
}

interface SyncCliOptions {
  command: 'sync';
  dryRun: boolean;
  fileId?: string;
  full: boolean;
  inventoryOnly: boolean;
  json: boolean;
  reseedSlugFileId?: string;
}

export type CliOptions =
  | GeneratedDiffCliOptions
  | SyncSummaryCliOptions
  | ValidateCliOptions
  | SyncCliOptions;

export class CliUsageError extends Error {
  override readonly name = 'CliUsageError';
}

export function parseCliOptions(arguments_: readonly string[]): CliOptions {
  const [command, ...flags] = arguments_;

  if (command === 'validate') {
    if (flags.length > 0) {
      throw new CliUsageError('The validate command does not accept options.');
    }
    return { command: 'validate' };
  }

  if (
    command === 'validate:generated-diff' ||
    command === 'write:sync-summary'
  ) {
    if (flags.length > 0) {
      throw new CliUsageError(
        `The ${command} command does not accept options.`,
      );
    }
    return { command };
  }

  if (command === 'sync') {
    const normalizedFlags = flags.filter((flag) => flag !== '--');
    let fileId: string | undefined;
    let reseedSlugFileId: string | undefined;
    const booleanFlags = new Set<string>();
    for (let index = 0; index < normalizedFlags.length; index += 1) {
      const flag = normalizedFlags[index];
      if (
        flag === '--dry-run' ||
        flag === '--full' ||
        flag === '--inventory-only' ||
        flag === '--json'
      ) {
        booleanFlags.add(flag);
        continue;
      }
      if (flag === '--file' || flag === '--reseed-slug') {
        const value = normalizedFlags[index + 1];
        if (
          !value ||
          value.startsWith('--') ||
          !/^[A-Za-z0-9_-]+$/u.test(value)
        ) {
          throw new CliUsageError(`${flag} requires a valid Google file ID.`);
        }
        if (flag === '--file') {
          if (fileId) {
            throw new CliUsageError('--file may only be provided once.');
          }
          fileId = value;
        } else {
          if (reseedSlugFileId) {
            throw new CliUsageError('--reseed-slug may only be provided once.');
          }
          reseedSlugFileId = value;
        }
        index += 1;
        continue;
      }
      throw new CliUsageError(`Unknown sync option: ${flag}`);
    }
    const inventoryOnly = booleanFlags.has('--inventory-only');
    if (inventoryOnly && !booleanFlags.has('--dry-run')) {
      throw new CliUsageError('--inventory-only requires --dry-run.');
    }
    if (
      inventoryOnly &&
      (booleanFlags.has('--full') || fileId || reseedSlugFileId)
    ) {
      throw new CliUsageError(
        '--inventory-only cannot be combined with an export option.',
      );
    }
    if (fileId && reseedSlugFileId) {
      throw new CliUsageError('--file and --reseed-slug cannot be combined.');
    }
    if (booleanFlags.has('--full') && (fileId || reseedSlugFileId)) {
      throw new CliUsageError(
        '--full cannot be combined with a targeted export option.',
      );
    }
    return {
      command: 'sync',
      dryRun: booleanFlags.has('--dry-run'),
      ...(fileId ? { fileId } : {}),
      full: booleanFlags.has('--full'),
      inventoryOnly,
      json: booleanFlags.has('--json'),
      ...(reseedSlugFileId ? { reseedSlugFileId } : {}),
    };
  }

  throw new CliUsageError(
    'Usage: ctcdocs-sync <sync [--dry-run] [--inventory-only] [--full] [--file <id>] [--reseed-slug <id>] [--json] | validate | validate:generated-diff | write:sync-summary>',
  );
}

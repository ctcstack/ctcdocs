export class CliUsageError extends Error {
    name = 'CliUsageError';
}
export function parseCliOptions(arguments_) {
    const [command, ...flags] = arguments_;
    if (command === 'validate') {
        if (flags.length > 0) {
            throw new CliUsageError('The validate command does not accept options.');
        }
        return { command: 'validate' };
    }
    if (command === 'validate:generated-diff' ||
        command === 'write:sync-summary' ||
        command === 'notify:failure' ||
        command === 'generated-paths') {
        if (flags.length > 0) {
            throw new CliUsageError(`The ${command} command does not accept options.`);
        }
        return { command };
    }
    if (command === 'sync') {
        const normalizedFlags = flags.filter((flag) => flag !== '--');
        let fileId;
        let reseedSlugFileId;
        const booleanFlags = new Set();
        for (let index = 0; index < normalizedFlags.length; index += 1) {
            const flag = normalizedFlags[index];
            if (flag === '--dry-run' ||
                flag === '--full' ||
                flag === '--inventory-only' ||
                flag === '--json') {
                booleanFlags.add(flag);
                continue;
            }
            if (flag === '--file' || flag === '--reseed-slug') {
                const value = normalizedFlags[index + 1];
                if (!value ||
                    value.startsWith('--') ||
                    !/^[A-Za-z0-9_-]+$/u.test(value)) {
                    throw new CliUsageError(`${flag} requires a valid Google file ID.`);
                }
                if (flag === '--file') {
                    if (fileId) {
                        throw new CliUsageError('--file may only be provided once.');
                    }
                    fileId = value;
                }
                else {
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
        if (inventoryOnly &&
            (booleanFlags.has('--full') || fileId || reseedSlugFileId)) {
            throw new CliUsageError('--inventory-only cannot be combined with an export option.');
        }
        if (fileId && reseedSlugFileId) {
            throw new CliUsageError('--file and --reseed-slug cannot be combined.');
        }
        if (booleanFlags.has('--full') && (fileId || reseedSlugFileId)) {
            throw new CliUsageError('--full cannot be combined with a targeted export option.');
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
    throw new CliUsageError('Usage: ctcdocs-sync <sync [--dry-run] [--inventory-only] [--full] [--file <id>] [--reseed-slug <id>] [--json] | validate | validate:generated-diff | write:sync-summary | notify:failure | generated-paths>');
}

interface ValidateCliOptions {
    command: 'validate';
}
interface GeneratedDiffCliOptions {
    command: 'validate:generated-diff';
}
interface SyncSummaryCliOptions {
    command: 'write:sync-summary';
}
interface NotifyFailureCliOptions {
    command: 'notify:failure';
}
/** Prints the paths a sync run may write, which is what the workflow stages. */
interface GeneratedPathsCliOptions {
    command: 'generated-paths';
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
export type CliOptions = GeneratedDiffCliOptions | GeneratedPathsCliOptions | NotifyFailureCliOptions | SyncSummaryCliOptions | ValidateCliOptions | SyncCliOptions;
export declare class CliUsageError extends Error {
    readonly name = "CliUsageError";
}
export declare function parseCliOptions(arguments_: readonly string[]): CliOptions;
export {};

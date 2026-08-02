export declare class SyncSummaryError extends Error {
    readonly name = "SyncSummaryError";
}
/**
 * Renders the last run's report into the workflow's job summary, so an operator
 * sees what a scheduled sync did without opening the log.
 */
export declare function writeSyncSummary(repositoryRoot: string, environment?: Record<string, string | undefined>): Promise<void>;

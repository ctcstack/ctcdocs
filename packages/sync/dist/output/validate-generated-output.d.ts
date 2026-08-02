import type { SyncContext } from '../project-context.js';
export declare class GeneratedOutputValidationError extends Error {
    readonly name = "GeneratedOutputValidationError";
}
export declare function validateGeneratedOutput(stagedRepositoryRoot: string, context: SyncContext): Promise<void>;

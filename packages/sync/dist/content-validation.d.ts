import type { SyncContext } from './project-context.js';
export interface ValidationResult {
    errors: string[];
    checkedFiles: number;
    /**
     * Whether the project has a generated corpus at all. A repository that has
     * never synced is valid — it just has nothing to build yet — and the caller
     * decides whether that is expected.
     */
    hasCorpus: boolean;
}
export declare function validateRepositoryContent(context: SyncContext): Promise<ValidationResult>;
